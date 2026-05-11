const bcrypt = require('bcrypt');
const pool   = require('../db/pool');

const SALT_ROUNDS = 10;

// POST /api/auth/register
const register = async (req, res) => {
  const { full_name, username, email, password } = req.body;

  if (!full_name || !username || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    const { rows } = await pool.query(
      `INSERT INTO users (full_name, username, email, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, full_name, username, email,
                 current_streak, longest_streak, created_at`,
      [full_name.trim(), username.trim(), email.trim().toLowerCase(), password_hash]
    );

    const user = rows[0];
    req.session.userId   = user.id;
    req.session.username = user.username;
    res.status(201).json({ user });
  } catch (err) {
    if (err.code === '23505') {
      const msg = err.constraint.includes('username')
        ? 'Username already taken'
        : 'Email already registered';
      return res.status(409).json({ error: msg });
    }
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
};

// POST /api/auth/login  (identifier = username OR email)
const login = async (req, res) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Username/email and password are required' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, username, email, password_hash,
              current_streak, longest_streak, last_seen, is_online
         FROM users
        WHERE username = $1 OR email = $1`,
      [identifier.trim()]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user  = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.userId   = user.id;
    req.session.username = user.username;

    const { password_hash, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
};

// POST /api/auth/logout
const logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out successfully' });
  });
};

// GET /api/auth/me
const me = async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, username, email,
              last_seen, is_online, current_streak, longest_streak, created_at
         FROM users
        WHERE id = $1`,
      [req.session.userId]
    );
    if (!rows.length) return res.status(401).json({ error: 'Session user not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    console.error('Me error:', err.message);
    res.status(500).json({ error: 'Failed to fetch session user' });
  }
};

module.exports = { register, login, logout, me };
