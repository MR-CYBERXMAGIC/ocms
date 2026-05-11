const pool = require('../db/pool');

// GET /api/contests/:id/leaderboard  (auth required, must be joined or manager)
const getLeaderboard = async (req, res) => {
  const contestId = req.params.id;
  const userId    = req.session.userId;

  try {
    const { rows: cRows } = await pool.query(
      `SELECT id, name, start_time, duration_minutes, is_ended, created_by
       FROM contests WHERE id = $1`,
      [contestId]
    );
    if (!cRows.length) return res.status(404).json({ error: 'Contest not found' });

    const contest   = cRows[0];
    const isManager = Number(contest.created_by) === Number(userId);

    if (!isManager) {
      const { rows: joinRows } = await pool.query(
        `SELECT 1 FROM contest_participants WHERE contest_id = $1 AND user_id = $2`,
        [contestId, userId]
      );
      if (!joinRows.length) {
        return res.status(403).json({ error: 'You must join the contest to view the leaderboard' });
      }
    }

    // Problem list for column headers
    const { rows: problemRows } = await pool.query(
      `SELECT cp.label, p.title
       FROM contest_problems cp
       JOIN problems p ON p.id = cp.problem_id
       WHERE cp.contest_id = $1
       ORDER BY cp.label ASC`,
      [contestId]
    );

    // Main query — one row per (participant × problem).
    // LEFT JOIN ... ON TRUE behaves like CROSS JOIN but preserves participant rows
    // when the contest has no problems yet (empty sub-select → NULL label).
    const { rows } = await pool.query(`
      WITH
      c_start AS (
        SELECT start_time FROM contests WHERE id = $1
      ),
      first_ac_ts AS (
        SELECT s.user_id, s.problem_id, MIN(s.submitted_at) AS ac_time
        FROM submissions s
        WHERE s.contest_id = $1 AND s.verdict = 'Accepted'
        GROUP BY s.user_id, s.problem_id
      ),
      first_ac AS (
        SELECT fa.user_id, fa.problem_id, fa.ac_time,
               FLOOR(EXTRACT(EPOCH FROM (fa.ac_time - cs.start_time)) / 60)::INT AS ac_minutes
        FROM first_ac_ts fa CROSS JOIN c_start cs
      ),
      wa_before_ac AS (
        SELECT s.user_id, s.problem_id, COUNT(*)::INT AS cnt
        FROM submissions s
        JOIN first_ac fa ON fa.user_id = s.user_id AND fa.problem_id = s.problem_id
        WHERE s.contest_id = $1
          AND s.verdict = 'Wrong Answer'
          AND s.submitted_at < fa.ac_time
        GROUP BY s.user_id, s.problem_id
      ),
      wa_total AS (
        SELECT s.user_id, s.problem_id, COUNT(*)::INT AS cnt
        FROM submissions s
        WHERE s.contest_id = $1 AND s.verdict = 'Wrong Answer'
        GROUP BY s.user_id, s.problem_id
      )
      SELECT
        p.user_id,
        p.username,
        COALESCE(lv.solved,  0) AS solved,
        COALESCE(lv.penalty, 0) AS penalty,
        pr.label,
        fa.ac_minutes,
        wba.cnt  AS wa_before_ac,
        wt.cnt   AS wa_total
      FROM (
        SELECT cp.user_id, u.username
        FROM contest_participants cp
        JOIN users u ON u.id = cp.user_id
        WHERE cp.contest_id = $1
      ) p
      LEFT JOIN leaderboard_view lv
        ON  lv.contest_id = $1 AND lv.user_id = p.user_id
      LEFT JOIN (
        SELECT cp.problem_id, cp.label
        FROM contest_problems cp
        WHERE cp.contest_id = $1
        ORDER BY cp.label
      ) pr ON TRUE
      LEFT JOIN first_ac fa
        ON  fa.user_id   = p.user_id AND fa.problem_id  = pr.problem_id
      LEFT JOIN wa_before_ac wba
        ON  wba.user_id  = p.user_id AND wba.problem_id = pr.problem_id
      LEFT JOIN wa_total wt
        ON  wt.user_id   = p.user_id AND wt.problem_id  = pr.problem_id
      ORDER BY
        COALESCE(lv.solved,  0) DESC,
        COALESCE(lv.penalty, 0) ASC,
        p.username ASC
    `, [contestId]);

    // Aggregate flat rows into per-user objects keyed by user_id
    const userMap = new Map();
    for (const row of rows) {
      if (!userMap.has(row.user_id)) {
        userMap.set(row.user_id, {
          user_id:  row.user_id,
          username: row.username,
          solved:   Number(row.solved),
          penalty:  Number(row.penalty),
          problems: {},
        });
      }

      if (row.label !== null) {
        const u = userMap.get(row.user_id);
        if (row.ac_minutes !== null) {
          u.problems[row.label] = {
            verdict:    'accepted',
            ac_minutes: Number(row.ac_minutes),
            wa_before:  Number(row.wa_before_ac) || 0,
          };
        } else if (row.wa_total) {
          u.problems[row.label] = {
            verdict:  'wrong',
            wa_count: Number(row.wa_total),
          };
        } else {
          u.problems[row.label] = { verdict: 'unattempted' };
        }
      }
    }

    // Sort descending solved, ascending penalty, alphabetical username
    const leaderboard = [...userMap.values()].sort((a, b) => {
      if (b.solved  !== a.solved)  return b.solved  - a.solved;
      if (a.penalty !== b.penalty) return a.penalty - b.penalty;
      return a.username.localeCompare(b.username);
    });

    // ICPC-style competition ranks: ties share the same rank; next rank skips
    let rank = 1;
    for (let i = 0; i < leaderboard.length; i++) {
      if (i > 0) {
        const prev = leaderboard[i - 1];
        const curr = leaderboard[i];
        if (curr.solved !== prev.solved || curr.penalty !== prev.penalty) {
          rank = i + 1;
        }
      }
      leaderboard[i].rank = rank;
    }

    res.json({
      contest: {
        id:               contest.id,
        name:             contest.name,
        start_time:       contest.start_time,
        duration_minutes: contest.duration_minutes,
        is_ended:         contest.is_ended,
      },
      problems: problemRows,
      leaderboard,
    });
  } catch (err) {
    console.error('getLeaderboard error:', err.message);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
};

module.exports = { getLeaderboard };
