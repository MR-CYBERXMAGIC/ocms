require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const session = require('express-session');
const path    = require('path');

const pool                        = require('./db/pool');
const { setLastSeen }             = require('./middleware/auth');
const { validateAndFetchProblem } = require('./services/problemScraper');

const app  = express();
const PORT = process.env.PORT || 3000;

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
// URL validation (used by create-contest page before contest exists)
// ------------------------------------------------------------------
app.get('/api/validate-url', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url parameter is required' });
  try {
    const result = await validateAndFetchProblem(url);
    if (!result.valid) return res.status(400).json({ error: result.error });
    res.json({ platform: result.platform, title: result.title });
  } catch (err) {
    res.status(500).json({ error: 'Validation failed' });
  }
});

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
// Start
// ------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Contest System API  →  http://localhost:${PORT}`);
  console.log(`Health check        →  http://localhost:${PORT}/api/health`);
});
