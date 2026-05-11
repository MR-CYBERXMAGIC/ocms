const pool = require('../db/pool');

// GET /api/profile/me  — full profile for the authenticated user
const getMe = async (req, res) => {
  const userId = req.session.userId;

  try {
    // Core stats (same shape as getUser but fetched by id)
    const { rows: userRows } = await pool.query(
      `SELECT
          u.full_name,
          u.username,
          u.email,
          u.last_seen,
          u.is_online,
          u.current_streak,
          u.longest_streak,
          COUNT(DISTINCT CASE WHEN s.verdict = 'Accepted' THEN s.problem_id END)::INT
            AS problems_solved,
          COUNT(DISTINCT s.problem_id)::INT
            AS problems_attempted
         FROM users u
         LEFT JOIN submissions s ON s.user_id = u.id
        WHERE u.id = $1
        GROUP BY u.id`,
      [userId]
    );

    if (!userRows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    const base     = userRows[0];
    const solved   = base.problems_solved;
    const attempted = base.problems_attempted;
    const acceptance_rate =
      attempted > 0
        ? parseFloat(((solved / attempted) * 100).toFixed(1))
        : 0;

    // Last 10 submissions — all verdicts, no code field
    const { rows: recentSubs } = await pool.query(
      `SELECT s.id, s.language, s.verdict, s.submitted_at,
              p.title AS problem_title,
              c.name  AS contest_name
         FROM submissions s
         JOIN problems  p ON p.id = s.problem_id
         LEFT JOIN contests c ON c.id = s.contest_id
        WHERE s.user_id = $1
        ORDER BY s.submitted_at DESC
        LIMIT 10`,
      [userId]
    );

    const { rows: contestHistory } = await pool.query(
      `SELECT c.id, c.name, c.start_time, c.duration_minutes, c.is_ended,
              COALESCE(lv.solved,  0) AS solved,
              COALESCE(lv.penalty, 0) AS penalty,
              (SELECT (COUNT(*) + 1)::INT
               FROM leaderboard_view lv2
               WHERE lv2.contest_id = c.id
                 AND (lv2.solved > COALESCE(lv.solved, 0)
                      OR (lv2.solved = COALESCE(lv.solved, 0)
                          AND lv2.penalty < COALESCE(lv.penalty, 2147483647)))
              ) AS rank
         FROM contests c
         JOIN contest_participants cp ON cp.contest_id = c.id AND cp.user_id = $1
         LEFT JOIN leaderboard_view lv ON lv.contest_id = c.id AND lv.user_id = $1
        ORDER BY c.start_time DESC`,
      [userId]
    );

    // Aggregate counts
    const { rows: countRows } = await pool.query(
      `SELECT
          (SELECT COUNT(*) FROM contests WHERE created_by = $1)::INT
            AS contests_created,
          (SELECT COUNT(*) FROM contest_participants WHERE user_id = $1)::INT
            AS contests_participated`,
      [userId]
    );

    res.json({
      ...base,
      acceptance_rate,
      recent_submissions:    recentSubs,
      contest_history:       contestHistory,
      contests_created:      countRows[0].contests_created,
      contests_participated: countRows[0].contests_participated,
    });
  } catch (err) {
    console.error('getMe error:', err.message);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
};

module.exports = { getMe };
