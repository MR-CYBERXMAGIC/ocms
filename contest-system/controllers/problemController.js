const pool = require('../db/pool');

// GET /api/contests/:id/problems/:problemId
const getProblemDetail = async (req, res) => {
  const contestId = req.params.id;
  const { problemId } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.title, p.type, p.platform, p.source_url,
              p.statement, p.input_format, p.output_format, p.constraints_text,
              p.time_limit_ms, p.memory_limit_mb, p.hints, cp.label
       FROM problems p
       JOIN contest_problems cp ON cp.problem_id = p.id
       WHERE p.id = $1 AND cp.contest_id = $2`,
      [problemId, contestId]
    );

    if (!rows.length) return res.status(404).json({ error: 'Problem not found in this contest' });

    const problem = rows[0];

    if (problem.type === 'custom') {
      const { rows: tcRows } = await pool.query(
        `SELECT id, input, expected_output
         FROM test_cases
         WHERE problem_id = $1 AND is_hidden = FALSE
         ORDER BY id ASC`,
        [problemId]
      );
      problem.sample_test_cases = tcRows;
    }

    res.json({ problem });
  } catch (err) {
    console.error('getProblemDetail error:', err.message);
    res.status(500).json({ error: 'Failed to fetch problem' });
  }
};

// POST /api/contests/:id/problems
const addProblem = async (req, res) => {
  const contestId = req.params.id;
  const userId    = req.session.userId;

  try {
    const { rows: contestRows } = await pool.query(
      `SELECT id, created_by FROM contests WHERE id = $1`,
      [contestId]
    );
    if (!contestRows.length) return res.status(404).json({ error: 'Contest not found' });
    if (Number(contestRows[0].created_by) !== Number(userId)) {
      return res.status(403).json({ error: 'Forbidden: only the contest manager can add problems' });
    }

    const { type } = req.body;
    if (!type || !['custom', 'external'].includes(type)) {
      return res.status(400).json({ error: "type must be 'custom' or 'external'" });
    }

    // Determine next label (A–Z)
    const { rows: labelRows } = await pool.query(
      `SELECT COALESCE(MAX(label), '@') AS max_label FROM contest_problems WHERE contest_id = $1`,
      [contestId]
    );
    const nextLabel = String.fromCharCode(labelRows[0].max_label.charCodeAt(0) + 1);
    if (nextLabel > 'Z') {
      return res.status(400).json({ error: 'Maximum of 26 problems per contest reached' });
    }

    let problemId;

    if (type === 'external') {
      const { platform, source_url, title } = req.body;
      if (!platform || !source_url) {
        return res.status(400).json({ error: 'platform and source_url are required for external problems' });
      }
      const { rows: pRows } = await pool.query(
        `INSERT INTO problems (title, type, platform, source_url, created_by)
         VALUES ($1, 'external', $2, $3, $4) RETURNING id`,
        [title || source_url, platform, source_url, userId]
      );
      problemId = pRows[0].id;
    } else {
      const {
        title, statement, input_format, output_format, constraints_text,
        time_limit_ms, memory_limit_mb, hints, model_solution, test_cases,
      } = req.body;

      if (!title || !statement) {
        return res.status(400).json({ error: 'title and statement are required for custom problems' });
      }

      const { rows: pRows } = await pool.query(
        `INSERT INTO problems
           (title, type, statement, input_format, output_format, constraints_text,
            time_limit_ms, memory_limit_mb, hints, model_solution, created_by)
         VALUES ($1, 'custom', $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          title, statement,
          input_format    || null,
          output_format   || null,
          constraints_text || null,
          time_limit_ms   ? parseInt(time_limit_ms)   : 1000,
          memory_limit_mb ? parseInt(memory_limit_mb) : 256,
          hints           || null,
          model_solution  || null,
          userId,
        ]
      );
      problemId = pRows[0].id;

      if (Array.isArray(test_cases) && test_cases.length) {
        for (const tc of test_cases) {
          await pool.query(
            `INSERT INTO test_cases (problem_id, input, expected_output, is_hidden)
             VALUES ($1, $2, $3, $4)`,
            [problemId, tc.input, tc.expected_output, tc.is_hidden || false]
          );
        }
      }
    }

    await pool.query(
      `INSERT INTO contest_problems (contest_id, problem_id, label) VALUES ($1, $2, $3)`,
      [contestId, problemId, nextLabel]
    );

    res.status(201).json({ problem_id: problemId, label: nextLabel });
  } catch (err) {
    console.error('addProblem error:', err.message);
    res.status(500).json({ error: 'Failed to add problem' });
  }
};

// DELETE /api/contests/:id/problems/:problemId
const removeProblem = async (req, res) => {
  const contestId  = req.params.id;
  const { problemId } = req.params;
  const userId     = req.session.userId;

  try {
    const { rows: contestRows } = await pool.query(
      `SELECT created_by, start_time FROM contests WHERE id = $1`,
      [contestId]
    );
    if (!contestRows.length) return res.status(404).json({ error: 'Contest not found' });

    const contest = contestRows[0];
    if (Number(contest.created_by) !== Number(userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (new Date(contest.start_time) <= new Date()) {
      return res.status(403).json({ error: 'Cannot remove problems after the contest has started' });
    }

    const { rowCount } = await pool.query(
      `DELETE FROM contest_problems WHERE contest_id = $1 AND problem_id = $2`,
      [contestId, problemId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Problem not found in this contest' });

    res.json({ message: 'Problem removed' });
  } catch (err) {
    console.error('removeProblem error:', err.message);
    res.status(500).json({ error: 'Failed to remove problem' });
  }
};

// POST /api/contests/:id/problems/:problemId/testcases/bulk
const bulkUploadTestCases = async (req, res) => {
  const contestId  = req.params.id;
  const { problemId } = req.params;
  const userId     = req.session.userId;

  try {
    const { rows: contestRows } = await pool.query(
      `SELECT created_by FROM contests WHERE id = $1`,
      [contestId]
    );
    if (!contestRows.length) return res.status(404).json({ error: 'Contest not found' });
    if (Number(contestRows[0].created_by) !== Number(userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { rows: cpRows } = await pool.query(
      `SELECT 1 FROM contest_problems WHERE contest_id = $1 AND problem_id = $2`,
      [contestId, problemId]
    );
    if (!cpRows.length) return res.status(404).json({ error: 'Problem not found in this contest' });

    if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });

    const text = req.file.buffer.toString('utf-8');
    const rows = parseCSV(text);

    // Skip header row if present
    const startIdx = rows.length > 0 && rows[0][0].toLowerCase() === 'input' ? 1 : 0;
    const data = rows.slice(startIdx);

    if (!data.length) return res.status(400).json({ error: 'CSV file contains no data rows' });

    let inserted = 0;
    for (const row of data) {
      if (row.length < 3) continue;
      const [input, expected_output, is_hidden_str] = row;
      const is_hidden =
        is_hidden_str.trim().toLowerCase() === 'true' || is_hidden_str.trim() === '1';
      await pool.query(
        `INSERT INTO test_cases (problem_id, input, expected_output, is_hidden)
         VALUES ($1, $2, $3, $4)`,
        [problemId, input, expected_output, is_hidden]
      );
      inserted++;
    }

    res.json({ message: `Inserted ${inserted} test case(s)`, inserted });
  } catch (err) {
    console.error('bulkUploadTestCases error:', err.message);
    res.status(500).json({ error: 'Failed to upload test cases' });
  }
};

// RFC-4180 compliant CSV parser (handles quoted fields with embedded newlines/commas)
function parseCSV(text) {
  const rows = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const row = [];

    while (i < n) {
      let field = '';

      if (text[i] === '"') {
        i++; // skip opening quote
        while (i < n) {
          if (text[i] === '"' && i + 1 < n && text[i + 1] === '"') {
            field += '"'; i += 2;
          } else if (text[i] === '"') {
            i++; break; // closing quote
          } else {
            field += text[i++];
          }
        }
      } else {
        while (i < n && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
          field += text[i++];
        }
        field = field.trim();
      }

      row.push(field);

      if (i < n && text[i] === ',') {
        i++; // another field follows
      } else {
        break; // end of record
      }
    }

    // Consume line ending
    if (i < n && text[i] === '\r') i++;
    if (i < n && text[i] === '\n') i++;

    if (row.length > 0 && !(row.length === 1 && row[0] === '')) {
      rows.push(row);
    }
  }

  return rows;
}

module.exports = { getProblemDetail, addProblem, removeProblem, bulkUploadTestCases };
