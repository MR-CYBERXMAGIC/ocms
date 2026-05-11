const bcrypt = require('bcrypt');
const pool   = require('../db/pool');

const SALT_ROUNDS = 10;

// GET /api/contests
const listContests = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.id,
        c.name,
        CASE WHEN c.start_time <= NOW() THEN 'Running' ELSE 'Upcoming' END AS status,
        c.start_time,
        c.duration_minutes,
        COUNT(DISTINCT cp.user_id)::INT   AS participant_count,
        COUNT(DISTINCT cpb.problem_id)::INT AS problem_count
      FROM contests c
      LEFT JOIN contest_participants cp  ON cp.contest_id  = c.id
      LEFT JOIN contest_problems    cpb ON cpb.contest_id = c.id
      WHERE c.is_ended = FALSE
        AND (c.start_time + (c.duration_minutes || ' minutes')::interval) > NOW()
      GROUP BY c.id, c.name, c.start_time, c.duration_minutes
      ORDER BY
        CASE WHEN c.start_time <= NOW() THEN 0 ELSE 1 END ASC,
        c.start_time ASC
    `);
    res.json({ contests: rows });
  } catch (err) {
    console.error('listContests error:', err.message);
    res.status(500).json({ error: 'Failed to fetch contests' });
  }
};

// POST /api/contests
const createContest = async (req, res) => {
  const { name, password, start_time, duration_minutes, description } = req.body;
  const userId = req.session.userId;

  if (!name || !start_time || !duration_minutes) {
    return res.status(400).json({ error: 'name, start_time, and duration_minutes are required' });
  }

  const startDate = new Date(start_time);
  if (isNaN(startDate.getTime()) || startDate <= new Date()) {
    return res.status(400).json({ error: 'start_time must be a valid date in the future' });
  }

  const durMins = parseInt(duration_minutes);
  if (isNaN(durMins) || durMins <= 0) {
    return res.status(400).json({ error: 'duration_minutes must be a positive integer' });
  }

  try {
    let password_hash = null;
    if (password && password.trim()) {
      password_hash = await bcrypt.hash(password.trim(), SALT_ROUNDS);
    }

    const { rows } = await pool.query(
      `INSERT INTO contests (name, description, password_hash, start_time, duration_minutes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [name.trim(), description || null, password_hash, startDate.toISOString(), durMins, userId]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A contest with that name already exists' });
    }
    console.error('createContest error:', err.message);
    res.status(500).json({ error: 'Failed to create contest' });
  }
};

// GET /api/contests/:id
const getContest = async (req, res) => {
  const { id } = req.params;
  const userId = req.session?.userId;

  try {
    const { rows: contestRows } = await pool.query(
      `SELECT id, name, description, start_time, duration_minutes, created_by, is_ended,
              (password_hash IS NOT NULL) AS is_protected
       FROM contests WHERE id = $1`,
      [id]
    );
    if (!contestRows.length) return res.status(404).json({ error: 'Contest not found' });

    const contest = contestRows[0];
    const endMs = new Date(contest.start_time).getTime() + contest.duration_minutes * 60 * 1000;
    const time_remaining_seconds = Math.max(0, Math.floor((endMs - Date.now()) / 1000));

    const { rows: problems } = await pool.query(
      `SELECT cp.label, p.id, p.title, p.type, p.platform,
              COUNT(DISTINCT s.user_id) FILTER (WHERE s.verdict = 'Accepted')::INT AS solved_by_count
       FROM contest_problems cp
       JOIN problems p ON p.id = cp.problem_id
       LEFT JOIN submissions s ON s.problem_id = p.id AND s.contest_id = $1
       WHERE cp.contest_id = $1
       GROUP BY cp.label, p.id, p.title, p.type, p.platform
       ORDER BY cp.label ASC`,
      [id]
    );

    let is_joined  = false;
    let is_manager = false;
    let user_score = null;
    let user_rank  = null;

    if (userId) {
      const { rows: joinRows } = await pool.query(
        `SELECT 1 FROM contest_participants WHERE contest_id = $1 AND user_id = $2`,
        [id, userId]
      );
      is_joined  = joinRows.length > 0;
      is_manager = Number(contest.created_by) === Number(userId);

      if (is_joined) {
        const { rows: scoreRows } = await pool.query(
          `SELECT solved, penalty FROM contest_scores WHERE contest_id = $1 AND user_id = $2`,
          [id, userId]
        );
        if (scoreRows.length) {
          const { solved, penalty } = scoreRows[0];
          user_score = { solved, penalty };
          const { rows: rankRows } = await pool.query(
            `SELECT (COUNT(*) + 1)::INT AS rank
             FROM contest_scores
             WHERE contest_id = $1
               AND (solved > $2 OR (solved = $2 AND penalty < $3))`,
            [id, solved, penalty]
          );
          user_rank = rankRows[0].rank;
        }
      }
    }

    res.json({
      id:                    contest.id,
      name:                  contest.name,
      description:           contest.description,
      start_time:            contest.start_time,
      duration_minutes:      contest.duration_minutes,
      is_ended:              contest.is_ended,
      is_protected:          contest.is_protected,
      problems,
      is_joined,
      is_manager,
      user_score,
      user_rank,
      time_remaining_seconds,
    });
  } catch (err) {
    console.error('getContest error:', err.message);
    res.status(500).json({ error: 'Failed to fetch contest' });
  }
};

// POST /api/contests/:id/join
const joinContest = async (req, res) => {
  const { id } = req.params;
  const userId = req.session.userId;
  const { password } = req.body;

  try {
    const { rows } = await pool.query(
      `SELECT id, password_hash FROM contests WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Contest not found' });

    const contest = rows[0];

    const { rows: existing } = await pool.query(
      `SELECT 1 FROM contest_participants WHERE contest_id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (existing.length) return res.status(409).json({ error: 'Already joined this contest' });

    if (contest.password_hash) {
      if (!password) return res.status(400).json({ error: 'This contest requires a password' });
      const valid = await bcrypt.compare(password, contest.password_hash);
      if (!valid) return res.status(401).json({ error: 'Incorrect contest password' });
    }

    await pool.query(
      `INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)`,
      [id, userId]
    );
    await pool.query(
      `INSERT INTO contest_scores (contest_id, user_id, solved, penalty)
       VALUES ($1, $2, 0, 0) ON CONFLICT DO NOTHING`,
      [id, userId]
    );

    res.json({ message: 'Joined contest successfully' });
  } catch (err) {
    console.error('joinContest error:', err.message);
    res.status(500).json({ error: 'Failed to join contest' });
  }
};

// GET /api/contests/:id/problems
const getContestProblems = async (req, res) => {
  const { id } = req.params;
  const userId = req.session?.userId;

  try {
    const { rows: problems } = await pool.query(
      `SELECT cp.label, p.id, p.title,
              COUNT(DISTINCT s.user_id) FILTER (WHERE s.verdict = 'Accepted')::INT AS solved_by_count
       FROM contest_problems cp
       JOIN problems p ON p.id = cp.problem_id
       LEFT JOIN submissions s ON s.problem_id = p.id AND s.contest_id = $1 AND s.verdict = 'Accepted'
       WHERE cp.contest_id = $1
       GROUP BY cp.label, p.id, p.title
       ORDER BY cp.label ASC`,
      [id]
    );

    for (const prob of problems) {
      if (userId) {
        const { rows: subRows } = await pool.query(
          `SELECT verdict FROM submissions
           WHERE contest_id = $1 AND problem_id = $2 AND user_id = $3
           ORDER BY submitted_at DESC`,
          [id, prob.id, userId]
        );
        if (!subRows.length) {
          prob.user_verdict = null;
        } else {
          const hasAc = subRows.some(s => s.verdict === 'Accepted');
          prob.user_verdict = hasAc
            ? 'Accepted'
            : `${subRows.length} attempt${subRows.length !== 1 ? 's' : ''}`;
        }
      } else {
        prob.user_verdict = null;
      }
    }

    res.json({ problems });
  } catch (err) {
    console.error('getContestProblems error:', err.message);
    res.status(500).json({ error: 'Failed to fetch problems' });
  }
};

// ================================================================
// Manager middleware & routes
// ================================================================

// Middleware: verify caller is the contest manager
const requireManager = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.session.userId;
  try {
    const { rows } = await pool.query(
      `SELECT created_by FROM contests WHERE id = $1`, [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Contest not found' });
    if (Number(rows[0].created_by) !== Number(userId)) {
      return res.status(403).json({ error: 'Manager access required' });
    }
    next();
  } catch (err) {
    console.error('requireManager error:', err.message);
    res.status(500).json({ error: 'Authorization check failed' });
  }
};

// GET /api/contests/:id/manager/submissions  ?problemId= &verdict=
const getManagerSubmissions = async (req, res) => {
  const { id } = req.params;
  const { problemId, verdict } = req.query;

  try {
    const params = [id];
    let idx = 2;
    let extra = '';

    if (problemId) { extra += ` AND s.problem_id = $${idx++}`; params.push(problemId); }
    if (verdict)   { extra += ` AND s.verdict    = $${idx++}`; params.push(verdict); }

    const { rows } = await pool.query(
      `SELECT
         u.username,
         COALESCE(cp.label, '?') AS problem_label,
         s.id                    AS submission_id,
         s.problem_id,
         s.language,
         s.verdict,
         s.submitted_at
       FROM submissions s
       JOIN  users u ON u.id = s.user_id
       LEFT JOIN contest_problems cp
         ON  cp.contest_id = s.contest_id AND cp.problem_id = s.problem_id
       WHERE s.contest_id = $1${extra}
       ORDER BY s.submitted_at DESC`,
      params
    );
    res.json({ submissions: rows });
  } catch (err) {
    console.error('getManagerSubmissions error:', err.message);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
};

// GET /api/contests/:id/manager/submissions/:submissionId
const getManagerSubmission = async (req, res) => {
  const { id, submissionId } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT s.*, u.username, COALESCE(cp.label, '?') AS problem_label
       FROM submissions s
       JOIN  users u ON u.id = s.user_id
       LEFT JOIN contest_problems cp
         ON  cp.contest_id = s.contest_id AND cp.problem_id = s.problem_id
       WHERE s.id = $1 AND s.contest_id = $2`,
      [submissionId, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Submission not found' });
    res.json({ submission: rows[0] });
  } catch (err) {
    console.error('getManagerSubmission error:', err.message);
    res.status(500).json({ error: 'Failed to fetch submission' });
  }
};

// GET /api/contests/:id/manager/stats
const getManagerStats = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT
         cp.label,
         p.title,
         COUNT(s.id)::INT                                                  AS total_submissions,
         COUNT(s.id) FILTER (WHERE s.verdict = 'Accepted')::INT           AS accepted_count,
         COUNT(DISTINCT s.user_id) FILTER (WHERE s.verdict = 'Accepted')::INT AS unique_solvers
       FROM contest_problems cp
       JOIN problems p ON p.id = cp.problem_id
       LEFT JOIN submissions s
         ON  s.problem_id  = cp.problem_id
         AND s.contest_id  = $1
         AND s.verdict NOT IN ('Pending', 'In Progress')
       WHERE cp.contest_id = $1
       GROUP BY cp.label, p.title
       ORDER BY cp.label ASC`,
      [id]
    );
    res.json({ stats: rows });
  } catch (err) {
    console.error('getManagerStats error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

// PATCH /api/contests/:id  — update name, description, password only
const updateContest = async (req, res) => {
  const { id } = req.params;
  const { name, description, password } = req.body;

  try {
    const sets   = [];
    const params = [];
    let   idx    = 1;

    if (name        !== undefined) { sets.push(`name        = $${idx++}`); params.push(name.trim()); }
    if (description !== undefined) { sets.push(`description = $${idx++}`); params.push(description || null); }
    if (password && password.trim()) {
      const hash = await bcrypt.hash(password.trim(), SALT_ROUNDS);
      sets.push(`password_hash = $${idx++}`);
      params.push(hash);
    }

    if (!sets.length) return res.status(400).json({ error: 'No updatable fields provided' });

    params.push(id);
    await pool.query(
      `UPDATE contests SET ${sets.join(', ')} WHERE id = $${idx}`,
      params
    );
    res.json({ message: 'Contest updated' });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Contest name already taken' });
    console.error('updateContest error:', err.message);
    res.status(500).json({ error: 'Failed to update contest' });
  }
};

// POST /api/contests/:id/end
const endContest = async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query(
      `UPDATE contests SET is_ended = TRUE WHERE id = $1 AND is_ended = FALSE`,
      [id]
    );
    if (rowCount === 0) return res.status(409).json({ error: 'Contest is already ended' });
    res.json({ message: 'Contest ended successfully' });
  } catch (err) {
    console.error('endContest error:', err.message);
    res.status(500).json({ error: 'Failed to end contest' });
  }
};

module.exports = {
  listContests, createContest, getContest, joinContest, getContestProblems,
  requireManager,
  getManagerSubmissions, getManagerSubmission, getManagerStats,
  updateContest, endContest,
};
