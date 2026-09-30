const jwt = require('jsonwebtoken');
const db = require('../db');

module.exports = async (req, res, next) => {
  const bearer = req.get('Authorization');
  const token = (bearer && /^Bearer\s+/i.test(bearer))
    ? bearer.replace(/^Bearer\s+/i, '')
    : req.cookies?.nnss_token;

  if (!token) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256']
    });

    const [[user]] = await db.query(
      'SELECT id, role, is_active, session_version FROM users WHERE id = ? LIMIT 1',
      [payload.id]
    );

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Your account is unavailable.' });
    }

    if (payload.sv !== user.session_version || payload.role !== user.role) {
      return res.status(401).json({ error: 'Your session is no longer valid. Please sign in again.' });
    }

    req.user = payload;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    }

    console.error('[auth/middleware]', err);
    return res.status(500).json({ error: 'Unable to verify your session.' });
  }
};
