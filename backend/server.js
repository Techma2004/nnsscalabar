require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 5000);
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const isProduction = process.env.NODE_ENV === 'production';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set and at least 32 characters long.');
}

app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

// Security headers without adding another runtime dependency.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

const allowedOrigins = (process.env.FRONTEND_ORIGIN || '')
  .split(',').map(v => v.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use((req, res, next) => {
  const raw = req.headers.cookie || '';
  req.cookies = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const key = decodeURIComponent(part.slice(0, i).trim());
    const value = decodeURIComponent(part.slice(i + 1).trim());
    req.cookies[key] = value;
  }
  next();
});


// Small in-memory rate limiter for authentication endpoints. For a multi-instance
// deployment, replace with a shared Redis-backed limiter.
const authAttempts = new Map();
function loginRateLimit(req, res, next) {
  const key = `${req.ip}:${String(req.body?.user_code || '').toUpperCase()}`;
  const now = Date.now();
  const entry = authAttempts.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 15 * 60 * 1000; }
  entry.count += 1;
  authAttempts.set(key, entry);
  if (entry.count > 10) return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  next();
}
app.use('/api/auth/login', loginRateLimit);

app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', service: 'nnss-calabar-api', database: 'connected', time: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'degraded', service: 'nnss-calabar-api', database: 'unavailable' });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/students', require('./routes/students'));
app.use('/api/results', require('./routes/results'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/dashboard', require('./routes/dashboard'));

// Serve the production frontend from the same origin. This removes the old
// localhost:5000 vs static-server mismatch and makes local/cloud deployment simpler.
if (fs.existsSync(FRONTEND_DIR)) {
  app.use(express.static(FRONTEND_DIR, { extensions: ['html'], maxAge: isProduction ? '1h' : 0 }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });
}

app.use((req, res) => res.status(404).json({ error: 'Route not found.' }));
app.use((err, req, res, next) => {
  console.error('[server]', err.stack || err.message || err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: isProduction ? 'An unexpected server error occurred.' : err.message });
});

const server = app.listen(PORT, async () => {
  try {
    await db.query('SELECT 1');
    console.log(`NNSS Calabar server listening on http://localhost:${PORT}`);
    console.log('Database connection: OK');
  } catch (err) {
    console.error('Database connection failed:', err.message);
  }
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down...`);
  server.close(async () => {
    try { await db.end(); } finally { process.exit(0); }
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
