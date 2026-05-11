require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const session = require('express-session');
const path    = require('path');

const pool             = require('./db/pool');
const { setLastSeen }  = require('./middleware/auth');

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
