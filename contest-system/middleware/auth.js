const pool = require('../db/pool');

// Reject unauthenticated requests to protected API endpoints.
const requireAuth = (req, res, next) => {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'Authentication required' });
};

// Fire-and-forget: stamp last_seen + is_online on every authenticated request.
const setLastSeen = (req, res, next) => {
  if (req.session && req.session.userId) {
    pool
      .query(
        'UPDATE users SET last_seen = NOW(), is_online = TRUE WHERE id = $1',
        [req.session.userId]
      )
      .catch(() => {}); // non-fatal; never block the response
  }
  next();
};

// Every 2 minutes: mark users offline if last_seen is >3 minutes ago.
setInterval(() => {
  pool
    .query(
      `UPDATE users
          SET is_online = FALSE
        WHERE is_online = TRUE
          AND last_seen < NOW() - INTERVAL '3 minutes'`
    )
    .catch((err) => console.error('Online-status sweep error:', err.message));
}, 2 * 60 * 1000);

module.exports = { requireAuth, setLastSeen };
