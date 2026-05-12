require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const session = require('express-session');
const path    = require('path');

const pool          = require('./db/pool');
const { setLastSeen } = require('./middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------------
// SSE client registry — must be defined before routes load
// ------------------------------------------------------------------
const contestClients = {};

global.broadcastToContest = function(contestId, event, data) {
  const clients = contestClients[contestId];
  if (!clients) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of Object.values(clients)) {
    try { res.write(msg); } catch (_) {}
  }
};

global.addSSEClient = (cid, id, res) => {
  if (!contestClients[cid]) contestClients[cid] = {};
  contestClients[cid][id] = res;
};

global.removeSSEClient = (cid, id) => {
  if (contestClients[cid]) delete contestClients[cid][id];
};

// ------------------------------------------------------------------
// Core middleware
// ------------------------------------------------------------------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 },
  })
);

// Stamp last_seen on every authenticated request (fire-and-forget)
app.use(setLastSeen);

// Static frontend — served before API routes so /index.html hits disk
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------------------------------------------
// API routes
// ------------------------------------------------------------------
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/users',       require('./routes/users'));
app.use('/api/profile',     require('./routes/profile'));
app.use('/api/contests',    require('./routes/contests'));
app.use('/api/submissions', require('./routes/submissions'));
app.post('/api/run',        require('./controllers/submissionController').runCode);

// ------------------------------------------------------------------
// Health check
// ------------------------------------------------------------------
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected', error: err.message });
  }
});

// ------------------------------------------------------------------
// 5-minute pre-end warning broadcasts (runs every 60 s)
// ------------------------------------------------------------------
setInterval(async () => {
  try {
    const { rows } = await pool.query(`
      SELECT id FROM contests
      WHERE is_ended = FALSE
        AND start_time <= NOW()
        AND (start_time + (duration_minutes || ' minutes')::interval)
              BETWEEN NOW() + interval '4 minutes 30 seconds'
              AND     NOW() + interval '5 minutes 30 seconds'
    `);
    for (const c of rows) {
      global.broadcastToContest(c.id, 'contest_warning', { message: '5 minutes remaining!' });
    }
  } catch (_) {}
}, 60000);

// ------------------------------------------------------------------
// Start
// ------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Contest System API  →  http://localhost:${PORT}`);
  console.log(`Health check        →  http://localhost:${PORT}/api/health`);
});
