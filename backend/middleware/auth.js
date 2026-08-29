const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const bearer = req.get('Authorization');
  const token = (bearer && /^Bearer\s+/i.test(bearer))
    ? bearer.replace(/^Bearer\s+/i, '')
    : req.cookies?.nnss_token;

  if (!token) return res.status(401).json({ error: 'Authentication required.' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    next();
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
};
