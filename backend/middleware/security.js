'use strict';
const rateLimit = require('express-rate-limit');

/**
 * Per-router request ceiling, applied in addition to the API-wide limiter in
 * server.js. Each router gets its own counter so one busy area of the portal
 * cannot starve another.
 */
function routeLimiter(max, message) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message || 'Too many requests. Please try again later.' }
  });
}

/**
 * Cookie parser that cannot throw and cannot be used for prototype pollution.
 * The previous inline version called decodeURIComponent() unguarded, so a
 * single malformed cookie (for example "a=%E0%A4%A") crashed the request, and
 * it wrote attacker-chosen keys onto a normal object.
 */
function parseCookies(req, res, next) {
  const cookies = Object.create(null);
  const raw = req.headers.cookie || '';
  if (raw.length <= 8192) {
    for (const part of raw.split(';')) {
      const i = part.indexOf('=');
      if (i < 1) continue;
      const key = safeDecode(part.slice(0, i).trim());
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      if (!(key in cookies)) cookies[key] = safeDecode(part.slice(i + 1).trim());
    }
  }
  req.cookies = cookies;
  next();
}
function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

/**
 * CSRF defence for cookie-authenticated requests. SameSite already blocks most
 * cross-site POSTs, but SameSite=Lax is relaxed on plain-HTTP LAN installs, so
 * the server also verifies where a state-changing request came from, using the
 * browser-set Sec-Fetch-Site and Origin headers (these cannot be forged by a
 * web page). Requests that carry neither header are not browser form/fetch
 * requests and are allowed through; they still need a valid token.
 */
function originGuard(isAllowedOrigin) {
  const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  return function originCheck(req, res, next) {
    if (!UNSAFE.has(req.method)) return next();
    const site = req.get('Sec-Fetch-Site');
    if (site && site !== 'same-origin' && site !== 'none') {
      const origin = req.get('Origin');
      if (!(origin && isAllowedOrigin(origin, req))) return forbid(res);
    }
    const origin = req.get('Origin');
    if (origin && !isAllowedOrigin(origin, req)) return forbid(res);
    next();
  };
}
function forbid(res) {
  return res.status(403).json({ error: 'Cross-site request blocked.' });
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Inline style attributes are used throughout the UI; scripts stay strict.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'"
].join('; ');

function securityHeaders(isProduction) {
  return function headers(req, res, next) {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // Student records and results must never be cached by browsers or proxies.
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  };
}

module.exports = { routeLimiter, parseCookies, originGuard, securityHeaders };
