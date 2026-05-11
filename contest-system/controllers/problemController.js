const { parse }                   = require('csv-parse/sync');
const pool                        = require('../db/pool');
const { validateAndFetchProblem } = require('../services/problemScraper');
const { fetchFullProblem }        = require('../services/externalFetcher');

// GET /api/contests/:id/problems/:problemId
const getProblemDetail = async (req, res) => {
  const contestId = req.params.id;
  const { problemId } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.title, p.type, p.platform, p.source_url,
              p.statement, p.input_format, p.output_format, p.constraints_text,
              p.time_limit_ms, p.memory_limit_mb, p.hints, p.fetch_status, p.sample_cases,
              cp.label
       FROM problems p
       JOIN contest_problems cp ON cp.problem_id = p.id
       WHERE p.id = $1 AND cp.contest_id = $2`,
      [problemId, contestId]
    );

    if (!rows.length) return res.status(404).json({ error: 'Problem not found in this contest' });

    const problem = rows[0];

    // Normalise sample_cases → always { input, expected_output }
    if (problem.type === 'custom') {
      const { rows: tcRows } = await pool.query(
        `SELECT input, expected_output
         FROM test_cases WHERE problem_id = $1 AND is_hidden = FALSE ORDER BY id ASC`,
        [problemId]
      );
      problem.sample_cases = tcRows;
    } else {
      const raw = Array.isArray(problem.sample_cases) ? problem.sample_cases : [];
      problem.sample_cases = raw.map(sc => ({
        input:           sc.input || '',
        expected_output: sc.expected_output || sc.output || '',
      }));
    }

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
      const { source_url } = req.body;
      if (!source_url) {
        return res.status(400).json({ error: 'source_url is required for external problems' });
      }

      // Validate URL and scrape title + platform
      const validation = await validateAndFetchProblem(source_url);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }
      const { title, platform } = validation;

      // Duplicate check: same URL or same title already in this contest
      const { rows: dupRows } = await pool.query(
        `SELECT cp.problem_id FROM contest_problems cp
           JOIN problems p ON p.id = cp.problem_id
          WHERE cp.contest_id = $1
            AND (p.source_url = $2 OR LOWER(p.title) = LOWER($3))
          LIMIT 1`,
        [contestId, source_url, title]
      );
      if (dupRows.length) {
        return res.status(409).json({ error: 'This problem is already in the contest.' });
      }

      const { rows: pRows } = await pool.query(
        `INSERT INTO problems (title, type, platform, source_url, created_by, fetch_status)
         VALUES ($1, 'external', $2, $3, $4, 'pending') RETURNING id`,
        [title, platform, source_url, userId]
      );
      problemId = pRows[0].id;

      // Fire-and-forget: scrape full problem content in background
      const _pid = problemId;
      (async () => {
        try {
          const fetched = await fetchFullProblem(platform, source_url);
          if (fetched.fetch_failed) {
            await pool.query(`UPDATE problems SET fetch_status = 'failed' WHERE id = $1`, [_pid]);
            return;
          }
          await pool.query(`
            UPDATE problems SET
              statement        = $1,
              input_format     = $2,
              output_format    = $3,
              constraints_text = $4,
              time_limit_ms    = $5,
              memory_limit_mb  = $6,
              sample_cases     = $7,
              fetch_status     = 'fetched'
            WHERE id = $8
          `, [
            fetched.statement,
            fetched.input_format,
            fetched.output_format,
            fetched.constraints_text,
            fetched.time_limit_ms,
            fetched.memory_limit_mb,
            JSON.stringify(fetched.sample_cases),
            _pid,
          ]);
          if (fetched.title && fetched.title.length > 2) {
            await pool.query(`UPDATE problems SET title = $1 WHERE id = $2`, [fetched.title, _pid]);
          }
          for (const sc of fetched.sample_cases) {
            await pool.query(
              `INSERT INTO test_cases (problem_id, input, expected_output, is_hidden) VALUES ($1, $2, $3, false)`,
              [_pid, sc.input, sc.output || sc.expected_output || '']
            );
          }
          console.log(`[Fetcher] Fetched external problem ${_pid} (${platform})`);
        } catch (e) {
          console.error('[Fetcher] Background fetch failed:', e.message);
        }
      })();

    } else {
      const {
        title, statement, input_format, output_format, constraints_text,
        time_limit_ms, memory_limit_mb, model_solution, test_cases,
      } = req.body;
      let { hints } = req.body;

      if (!title || !statement) {
        return res.status(400).json({ error: 'title and statement are required for custom problems' });
      }

      // Duplicate check: same title already in this contest
      const { rows: dupRows } = await pool.query(
        `SELECT cp.problem_id FROM contest_problems cp
           JOIN problems p ON p.id = cp.problem_id
          WHERE cp.contest_id = $1 AND LOWER(p.title) = LOWER($2)
          LIMIT 1`,
        [contestId, title]
      );
      if (dupRows.length) {
        return res.status(409).json({ error: 'A problem with this title is already in the contest.' });
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
          title, statement,
          input_format     || null,
          output_format    || null,
          constraints_text || null,
          time_limit_ms    ? parseInt(time_limit_ms)    : 1000,
          memory_limit_mb  ? parseInt(memory_limit_mb)  : 256,
          hints,
          model_solution   || null,
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
