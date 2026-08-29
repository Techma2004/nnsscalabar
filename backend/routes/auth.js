const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();
const isProduction = process.env.NODE_ENV === 'production';
const cookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'strict' : 'lax',
  maxAge: 8 * 60 * 60 * 1000,
  path: '/'
};

function safeUser(row) {
  return { id: row.id, user_code: row.user_code, name: row.full_name, email: row.email, role: row.role };
}

router.post('/login', async (req, res) => {
  const user_code = String(req.body?.user_code || '').trim().toUpperCase();
  const password = String(req.body?.password || '');
  if (!user_code || !password) return res.status(400).json({ error: 'User ID and password are required.' });

  try {
    const [rows] = await db.query(
      `SELECT id, user_code, full_name, email, role, password_hash, is_active
       FROM users WHERE user_code = ? LIMIT 1`, [user_code]
    );
    const user = rows[0];
    const valid = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!user || !valid || !user.is_active) return res.status(401).json({ error: 'Invalid user ID or password.' });

    const token = jwt.sign(
      { id: user.id, user_code: user.user_code, role: user.role, name: user.full_name },
      process.env.JWT_SECRET,
      { expiresIn: '8h', algorithm: 'HS256' }
    );

    await db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
    res.cookie('nnss_token', token, cookieOptions);
    res.json({ user: safeUser(user) });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Unable to complete sign in.' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('nnss_token', { httpOnly: true, secure: isProduction, sameSite: isProduction ? 'strict' : 'lax', path: '/' });
  res.json({ message: 'Signed out successfully.' });
});

router.get('/me', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, user_code, full_name, email, phone, role, gender, is_active, last_login, profile_photo
       FROM users WHERE id = ? LIMIT 1`, [req.user.id]
    );
    if (!rows.length || !rows[0].is_active) return res.status(401).json({ error: 'Account unavailable.' });
    res.json(safeUser(rows[0]));
  } catch (err) {
    console.error('[auth/me]', err);
    res.status(500).json({ error: 'Unable to load account.' });
  }
});

module.exports = router;
