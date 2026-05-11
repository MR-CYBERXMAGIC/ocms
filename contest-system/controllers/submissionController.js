const pool = require('../db/pool');
const { runOnOneCompiler, judgeSubmission, LANGUAGE_MAP } = require('../services/judge');

const VALID_LANGUAGES = Object.keys(LANGUAGE_MAP);

// POST /api/contests/:id/problems/:problemId/submit
const submitSolution = async (req, res) => {
  const contestId = req.params.id;
  const { problemId } = req.params;
  const userId = req.session.userId;
  const { language, code } = req.body;

  if (!language || !VALID_LANGUAGES.includes(language)) {
    return res.status(400).json({ error: `language must be one of: ${VALID_LANGUAGES.join(', ')}` });
  }
  if (!code || !code.trim()) {
    return res.status(400).json({ error: 'code is required' });
  }

  try {
    const { rows: cRows } = await pool.query(
      `SELECT id, start_time, duration_minutes, is_ended FROM contests WHERE id = $1`,
      [contestId]
    );
    if (!cRows.length) return res.status(404).json({ error: 'Contest not found' });

    const contest = cRows[0];
    const now     = Date.now();
    const startMs = new Date(contest.start_time).getTime();
    const endMs   = startMs + contest.duration_minutes * 60 * 1000;

    if (contest.is_ended || now < startMs || now > endMs) {
      return res.status(400).json({ error: 'Contest is not currently running' });
    }

    const { rows: partRows } = await pool.query(
      `SELECT is_blocked FROM contest_participants WHERE contest_id = $1 AND user_id = $2`,
      [contestId, userId]
    );
    if (!partRows.length) {
      return res.status(403).json({ error: 'You must join the contest before submitting' });
    }
    if (partRows[0].is_blocked) {
      return res.status(403).json({ error: 'You have been blocked from this contest' });
    }

    const { rows: pRows } = await pool.query(
      `SELECT p.id, p.type, p.source_url, p.platform
       FROM problems p
       JOIN contest_problems cp ON cp.problem_id = p.id
       WHERE cp.contest_id = $1 AND p.id = $2`,
      [contestId, problemId]
    );
    if (!pRows.length) return res.status(404).json({ error: 'Problem not found in this contest' });

    const problem = pRows[0];

    const { rows: subRows } = await pool.query(
      `INSERT INTO submissions (user_id, contest_id, problem_id, language, code, verdict)
       VALUES ($1, $2, $3, $4, $5, 'Pending')
       RETURNING id`,
      [userId, contestId, problemId, language, code]
    );
    const submissionId = subRows[0].id;

    res.status(202).json({ submission_id: submissionId });

    // Judge in background — response already sent
    judgeInBackground(submissionId, userId, parseInt(contestId), parseInt(problemId), language, code, problem);
  } catch (err) {
    console.error('submitSolution error:', err.message);
    res.status(500).json({ error: 'Failed to submit solution' });
  }
};

async function judgeInBackground(submissionId, userId, contestId, problemId, language, code, problem) {
  try {
    if (problem.type === 'custom') {
      const verdict = await judgeSubmission(pool, submissionId, problemId, code, language);
      if (verdict === 'Accepted') {
        await updateStreak(userId);
      }
    }
    // External problems stay as 'Pending' — no auto-judging
  } catch (err) {
    console.error(`[Judge] Background error for submission ${submissionId}:`, err.message);
    await pool.query(
      `UPDATE submissions SET verdict = 'Runtime Error'
       WHERE id = $1 AND verdict IN ('Pending', 'In Progress')`,
      [submissionId]
    ).catch(() => {});
  }
}

async function updateStreak(userId) {
  await pool.query(
    `INSERT INTO user_daily_activity (user_id, activity_date)
     VALUES ($1, CURRENT_DATE) ON CONFLICT DO NOTHING`,
    [userId]
  );

  let streak = 1;
  const checkDate = new Date();
  checkDate.setDate(checkDate.getDate() - 1);
  for (let i = 0; i < 365; i++) {
    const dateStr = checkDate.toISOString().split('T')[0];
    const { rows } = await pool.query(
      `SELECT 1 FROM user_daily_activity WHERE user_id = $1 AND activity_date = $2`,
      [userId, dateStr]
    );
    if (!rows.length) break;
    streak++;
    checkDate.setDate(checkDate.getDate() - 1);
  }

  await pool.query(
    `UPDATE users
     SET current_streak  = $1,
         longest_streak  = GREATEST(longest_streak, $1)
     WHERE id = $2`,
    [streak, userId]
  );
}

// GET /api/contests/:id/problems/:problemId/submissions
const getProblemSubmissions = async (req, res) => {
  const contestId = req.params.id;
  const { problemId } = req.params;
  const userId = req.session.userId;

  try {
    const { rows } = await pool.query(
      `SELECT id, submitted_at, language, verdict, execution_time_ms
       FROM submissions
       WHERE user_id = $1 AND contest_id = $2 AND problem_id = $3
       ORDER BY submitted_at DESC`,
      [userId, contestId, problemId]
    );
    res.json({ submissions: rows });
  } catch (err) {
    console.error('getProblemSubmissions error:', err.message);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
};

// GET /api/submissions/:submissionId
const getSubmission = async (req, res) => {
  const { submissionId } = req.params;
  const userId = req.session.userId;

  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.user_id, s.contest_id, s.problem_id, s.language, s.code,
              s.verdict, s.execution_time_ms, s.submitted_at,
              c.created_by AS contest_manager_id
       FROM submissions s
       LEFT JOIN contests c ON c.id = s.contest_id
       WHERE s.id = $1`,
      [submissionId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Submission not found' });

    const sub       = rows[0];
    const isOwner   = Number(sub.user_id) === Number(userId);
    const isManager = Number(sub.contest_manager_id) === Number(userId);

    if (!isOwner && !isManager) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json({
      submission: {
        id:                sub.id,
        user_id:           sub.user_id,
        contest_id:        sub.contest_id,
        problem_id:        sub.problem_id,
        language:          sub.language,
        verdict:           sub.verdict,
        execution_time_ms: sub.execution_time_ms,
        submitted_at:      sub.submitted_at,
        code:              (isOwner || isManager) ? sub.code : null,
      },
    });
  } catch (err) {
    console.error('getSubmission error:', err.message);
    res.status(500).json({ error: 'Failed to fetch submission' });
  }
};

// GET /api/submissions/:submissionId/status  (polling — no auth required)
const getSubmissionStatus = async (req, res) => {
  const { submissionId } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT verdict FROM submissions WHERE id = $1`,
      [submissionId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Submission not found' });
    res.json({ verdict: rows[0].verdict });
  } catch (err) {
    console.error('getSubmissionStatus error:', err.message);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
};

// POST /api/run — proxy to OneCompiler (used by the Run button)
const runCode = async (req, res) => {
  const { language, code, stdin } = req.body;
  if (!language || !code) {
    return res.status(400).json({ error: 'language and code are required' });
  }

  try {
    const result = await runOnOneCompiler(code, language, stdin || '');
    res.json({
      stdout:        result.stdout        || '',
      stderr:        result.stderr        || '',
      executionTime: result.executionTime || 0,
      status:        result.status        || '',
    });
  } catch (err) {
    console.error('runCode error:', err.message);
    res.status(500).json({ error: 'Failed to run code: ' + err.message });
  }
};

module.exports = {
  submitSolution,
  getProblemSubmissions,
  getSubmission,
  getSubmissionStatus,
  runCode,
};
