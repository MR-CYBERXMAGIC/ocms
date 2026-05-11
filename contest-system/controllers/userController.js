const pool = require('../db/pool');

// GET /api/users?search=
const getUsers = async (req, res) => {
  const search = (req.query.search || '').trim();

  try {
    const { rows } = await pool.query(
      `SELECT
          u.full_name,
          u.username,
          u.last_seen,
          u.is_online,
          COUNT(DISTINCT CASE WHEN s.verdict = 'Accepted' THEN s.problem_id END)::INT
            AS problems_solved,
          COUNT(DISTINCT s.problem_id)::INT
            AS problems_attempted,
          ROUND(
            COUNT(DISTINCT CASE WHEN s.verdict = 'Accepted' THEN s.problem_id END)::NUMERIC
            / NULLIF(COUNT(DISTINCT s.problem_id)::NUMERIC, 0) * 100,
            1
          ) AS acceptance_rate
         FROM users u
         LEFT JOIN submissions s ON s.user_id = u.id
        WHERE $1 = ''
           OR u.full_name ILIKE '%' || $1 || '%'
           OR u.username  ILIKE '%' || $1 || '%'
        GROUP BY u.id, u.full_name, u.username, u.last_seen, u.is_online
        ORDER BY u.is_online DESC, problems_solved DESC, u.username ASC`,
      [search]
    );
    res.json({ users: rows });
  } catch (err) {
    console.error('getUsers error:', err.message);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

// GET /api/users/:username
const getUser = async (req, res) => {
  const { username } = req.params;

  try {
    // Core profile stats
    const { rows: userRows } = await pool.query(
      `SELECT
          u.id,
          u.full_name,
          u.username,
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
        WHERE u.username = $1
        GROUP BY u.id, u.full_name, u.username, u.last_seen, u.is_online,
                 u.current_streak, u.longest_streak`,
      [username]
    );

    if (!userRows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { id: userId, ...userProfile } = userRows[0];

    const { rows: contestRows } = await pool.query(
      `SELECT c.id, c.name, c.start_time, c.is_ended,
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

    // Last 10 accepted submissions — code column deliberately excluded
    const { rows: acRows } = await pool.query(
      `SELECT s.id, s.language, s.verdict, s.submitted_at,
              p.title AS problem_title
         FROM submissions s
         JOIN problems p ON p.id = s.problem_id
         JOIN users  u  ON u.id = s.user_id
        WHERE u.username = $1
          AND s.verdict  = 'Accepted'
        ORDER BY s.submitted_at DESC
        LIMIT 10`,
      [username]
    );

    const solved    = userProfile.problems_solved;
    const attempted = userProfile.problems_attempted;
    const acceptance_rate = attempted > 0
      ? parseFloat(((solved / attempted) * 100).toFixed(1))
      : 0;

    res.json({
      user: {
        ...userProfile,
        acceptance_rate,
        contest_history:       contestRows,
        recent_ac_submissions: acRows,
      },
    });
  } catch (err) {
    console.error('getUser error:', err.message);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
};

module.exports = { getUsers, getUser };
