const { parse } = require('csv-parse/sync');
const pool      = require('../db/pool');

// GET /api/contests/:id/problems/:problemId
const getProblemDetail = async (req, res) => {
  const contestId = req.params.id;
  const { problemId } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.title, p.type,
              p.statement, p.input_format, p.output_format, p.constraints_text,
              p.time_limit_ms, p.memory_limit_mb, p.hints,
              cp.label
       FROM problems p
       JOIN contest_problems cp ON cp.problem_id = p.id
       WHERE p.id = $1 AND cp.contest_id = $2`,
      [problemId, contestId]
    );

    if (!rows.length) return res.status(404).json({ error: 'Problem not found in this contest' });

    const problem = rows[0];

    const { rows: tcRows } = await pool.query(
      `SELECT input, expected_output
       FROM test_cases WHERE problem_id = $1 AND is_hidden = FALSE ORDER BY id ASC`,
      [problemId]
    );
    problem.sample_cases = tcRows;

    // Ensure hints is always an array
    if (!Array.isArray(problem.hints)) {
      problem.hints = problem.hints ? [problem.hints] : [];
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

    const {
      title, statement, input_format, output_format, constraints_text,
      time_limit_ms, memory_limit_mb, model_solution, sample_cases,
    } = req.body;
    let { hints } = req.body;

    if (!title || !title.trim())
      return res.status(400).json({ error: 'Problem title is required.' });
    if (!statement || !statement.trim())
      return res.status(400).json({ error: 'Problem statement is required.' });
    if (!input_format || !input_format.trim())
      return res.status(400).json({ error: 'Input format is required.' });
    if (!output_format || !output_format.trim())
      return res.status(400).json({ error: 'Output format is required.' });

    // Duplicate check: same title already in this contest
    const { rows: dupRows } = await pool.query(
      `SELECT cp.problem_id FROM contest_problems cp
         JOIN problems p ON p.id = cp.problem_id
        WHERE cp.contest_id = $1 AND LOWER(p.title) = LOWER($2)
        LIMIT 1`,
      [contestId, title.trim()]
    );
    if (dupRows.length) {
      return res.status(409).json({ error: 'A problem with this title is already in this contest.' });
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

    // Normalise hints to TEXT[] — accept string, array, or null
    if (!Array.isArray(hints)) hints = hints ? [hints] : [];

    const { rows: pRows } = await pool.query(
      `INSERT INTO problems
         (title, type, statement, input_format, output_format, constraints_text,
          time_limit_ms, memory_limit_mb, hints, model_solution, created_by)
       VALUES ($1, 'custom', $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        title.trim(), statement.trim(),
        input_format     ? input_format.trim()     : null,
        output_format    ? output_format.trim()    : null,
        constraints_text ? constraints_text.trim() : null,
        time_limit_ms    ? parseInt(time_limit_ms)    : 1000,
        memory_limit_mb  ? parseInt(memory_limit_mb)  : 256,
        hints,
        model_solution   || null,
        userId,
      ]
    );
    const problemId = pRows[0].id;

    if (Array.isArray(sample_cases) && sample_cases.length) {
      for (const sc of sample_cases) {
        if (sc.input !== undefined && sc.expected_output !== undefined) {
          await pool.query(
            `INSERT INTO test_cases (problem_id, input, expected_output, is_hidden) VALUES ($1, $2, $3, false)`,
            [problemId, sc.input, sc.expected_output]
          );
        }
      }
    }

    await pool.query(
      `INSERT INTO contest_problems (contest_id, problem_id, label) VALUES ($1, $2, $3)`,
      [contestId, problemId, nextLabel]
    );

    global.broadcastToContest(Number(contestId), 'problem_added', {
      problem_id: problemId,
      label:      nextLabel,
      title:      title.trim(),
    });

    res.status(201).json({ id: problemId, problem_id: problemId, label: nextLabel, title: title.trim() });
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

  const client = await pool.connect();
  try {
    const { rows: contestRows } = await client.query(
      `SELECT created_by, start_time, is_ended FROM contests WHERE id = $1`,
      [contestId]
    );
    if (!contestRows.length) return res.status(404).json({ error: 'Contest not found' });

    const contest = contestRows[0];
    if (Number(contest.created_by) !== Number(userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (contest.is_ended) {
      return res.status(403).json({ error: 'Cannot modify problems after the contest has ended' });
    }

    // Get the label before deleting
    const { rows: cpRows } = await client.query(
      `SELECT label FROM contest_problems WHERE contest_id = $1 AND problem_id = $2`,
      [contestId, problemId]
    );
    if (!cpRows.length) return res.status(404).json({ error: 'Problem not found in this contest' });
    const removedLabel = cpRows[0].label;

    await client.query('BEGIN');

    // Delete submissions for this problem in this contest
    await client.query(
      `DELETE FROM submissions WHERE contest_id = $1 AND problem_id = $2`,
      [contestId, problemId]
    );

    // Remove from contest_problems
    await client.query(
      `DELETE FROM contest_problems WHERE contest_id = $1 AND problem_id = $2`,
      [contestId, problemId]
    );

    // Re-label remaining problems sequentially (A, B, C…)
    const { rows: remaining } = await client.query(
      `SELECT problem_id FROM contest_problems WHERE contest_id = $1 ORDER BY label ASC`,
      [contestId]
    );
    for (let i = 0; i < remaining.length; i++) {
      const newLabel = String.fromCharCode('A'.charCodeAt(0) + i);
      await client.query(
        `UPDATE contest_problems SET label = $1 WHERE contest_id = $2 AND problem_id = $3`,
        [newLabel, contestId, remaining[i].problem_id]
      );
    }

    // Recalculate scores if contest has started
    const isStarted = new Date(contest.start_time) <= new Date();
    if (isStarted) {
      await client.query(`CALL recalculate_contest_scores($1)`, [contestId]);
    }

    await client.query('COMMIT');

    global.broadcastToContest(Number(contestId), 'problem_deleted', {
      problem_id: Number(problemId),
      label:      removedLabel,
    });

    res.json({ message: 'Problem removed' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('removeProblem error:', err.message);
    res.status(500).json({ error: 'Failed to remove problem' });
  } finally {
    client.release();
  }
};

// POST /api/contests/:id/problems/:problemId/testcases/bulk
const bulkUploadTestCases = async (req, res) => {
  const contestId     = req.params.id;
  const { problemId } = req.params;
  const userId        = req.session.userId;

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

    const csvText = req.body.csv;
    if (!csvText) return res.status(400).json({ error: 'No CSV data provided.' });

    const records = parse(csvText, {
      columns:          true,
      skip_empty_lines: true,
      trim:             true,
      cast: (value, ctx) => {
        if (ctx.column === 'is_hidden') return value.toLowerCase() === 'true';
        return value.replace(/\\n/g, '\n');
      },
    });

    if (!records.length) return res.status(400).json({ error: 'CSV is empty.' });

    const first = records[0];
    if (!('is_hidden' in first) || !('input' in first) || !('expected_output' in first)) {
      return res.status(400).json({
        error: 'CSV must have columns: is_hidden, input, expected_output',
      });
    }

    if (records.length > 100) {
      return res.status(400).json({ error: 'Max 100 test cases per upload.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of records) {
        await client.query(
          `INSERT INTO test_cases (problem_id, input, expected_output, is_hidden)
           VALUES ($1, $2, $3, $4)`,
          [problemId, row.input, row.expected_output, row.is_hidden]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const hidden  = records.filter(r => r.is_hidden).length;
    const visible = records.length - hidden;
    res.json({ inserted: records.length, visible, hidden });

  } catch (err) {
    console.error('bulkUploadTestCases error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to upload test cases' });
  }
};

module.exports = { getProblemDetail, addProblem, removeProblem, bulkUploadTestCases };
