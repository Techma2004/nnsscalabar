require('dotenv').config();
const os = require('os');
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 5000);
const HOST = process.env.HOST || '0.0.0.0';
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

// ---- CORS: explicit allowlist + automatic same-network access ----
// FRONTEND_ORIGIN lets an operator explicitly whitelist a public domain (e.g. a
// real school domain once one exists). Beyond that, this app is designed to be
// opened directly on the school's local network — a teacher's laptop, a lab PC,
// a phone on the school wifi — all hitting this same server's LAN IP. Those
// requests are same-origin in the browser (the frontend is served from this
// same host:port), but some browsers still attach an Origin header, so we
// recognise and allow any private/loopback network address rather than
// silently accepting every origin when FRONTEND_ORIGIN isn't set.
const explicitOrigins = (process.env.FRONTEND_ORIGIN || '')
  .split(',').map(v => v.trim()).filter(Boolean);

function isPrivateNetworkOrigin(origin) {
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)
    );
  } catch {
    return false;
  }
}

app.use(cors({
  origin(origin, callback) {
    if (!origin || explicitOrigins.includes(origin) || isPrivateNetworkOrigin(origin)) return callback(null, true);
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

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }
  return addresses;
}

const server = app.listen(PORT, HOST, async () => {
  try {
    await db.query('SELECT 1');
    console.log('Database connection: OK');
  } catch (err) {
    console.error('Database connection failed:', err.message);
  }
  console.log(`NNSS Calabar server listening on http://localhost:${PORT}`);
  if (HOST === '0.0.0.0' || HOST === '::') {
    const lan = getLanAddresses();
    if (lan.length) {
      console.log('Also reachable on this network at:');
      lan.forEach(ip => console.log(`  http://${ip}:${PORT}`));
      console.log('Share one of the addresses above with devices on the same wifi/LAN to let them use the portal.');
    } else {
      console.log('No LAN network interface detected yet — connect this machine to the school network to enable local-network access.');
    }
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
