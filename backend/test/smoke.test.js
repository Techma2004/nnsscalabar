/*
 * Smoke tests that run without MySQL: the database module is replaced with a
 * small in-memory stub, so these exercise the real Express app (boot, routing,
 * security headers, CSRF origin guard, cookie parsing, input validation).
 *
 *   cd backend && npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const PORT = 5071;
process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('base64url');
process.env.DB_PASSWORD = crypto.randomBytes(8).toString('hex');

const PASSWORD = crypto.randomBytes(9).toString('base64url');
const HASH = bcrypt.hashSync(PASSWORD, 4);
const USERS = {
  ADM001: { id: 1, user_code: 'ADM001', full_name: 'Test Admin', email: null, role: 'admin', password_hash: HASH, is_active: 1, session_version: 0 }
};

// ---- stub the DB before the app loads --------------------------------------
const stub = {
  async query(sql, params = []) {
    if (/FROM users WHERE user_code/.test(sql)) return [[USERS[params[0]]].filter(Boolean)];
    if (/FROM users WHERE id\s*=\s*\?/.test(sql)) return [[Object.values(USERS).find(u => u.id === params[0])].filter(Boolean)];
    if (/UPDATE users SET last_login/.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  },
  async getConnection() { throw new Error('getConnection should not be reached by these tests'); },
  async end() {}
};
const dbPath = require.resolve('../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: stub };

const app = require('../server');
// Tests talk to the in-process server on the loopback interface only; TLS does not apply.
const base = `http://127.0.0.1:${PORT}`; // nosemgrep
const request = (route, init) => fetch(new URL(route, base), init);
test.after(() => app.server.close());

const json = (method, url, body, headers = {}) => {
  const init = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return request(url, init);
};

async function adminCookie() {
  const res = await json('POST', '/api/auth/login', { user_code: 'ADM001', password: PASSWORD });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

test('server boots and serves the SPA fallback (Express 5 wildcard route)', async () => {
  const home = await request('/');
  assert.equal(home.status, 200);
  const deep = await request('/some/client/route');
  assert.equal(deep.status, 200);
  assert.match(await deep.text(), /<html/i);
  const api = await request('/api/does-not-exist');
  assert.equal(api.status, 404);
});

test('security headers are set, with a script-src that forbids inline scripts', async () => {
  const res = await request('/');
  const csp = res.headers.get('content-security-policy');
  assert.ok(csp, 'CSP header missing');
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.doesNotMatch(csp.match(/script-src[^;]*/)[0], /unsafe-inline|unsafe-eval/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
  const api = await request('/api/health');
  assert.equal(api.headers.get('cache-control'), 'no-store');
});

test('no frontend page uses inline scripts or inline event handlers (required by the CSP)', () => {
  const fs = require('node:fs');
  const dir = path.join(__dirname, '..', '..', 'frontend');
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${file} has an inline <script>`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i, `${file} has an inline event handler`);
  }
  for (const file of ['portal.js', 'commandant.js', 'sheets.js', 'assignments.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(dir, file), 'utf8'), /\son[a-z]+="/i, `${file} generates an inline event handler`);
  }
});

test('CSRF guard blocks cross-site state-changing requests but allows same-origin', async () => {
  const body = { user_code: 'ADM001', password: 'wrong-password-123' };
  const evil = await json('POST', '/api/auth/login', body, { Origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  const crossSite = await json('POST', '/api/auth/login', body, { 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(crossSite.status, 403);
  const same = await json('POST', '/api/auth/login', body, { Origin: base, 'Sec-Fetch-Site': 'same-origin' });
  assert.equal(same.status, 401); // reached the handler; wrong password
});

test('login works, cookie is HttpOnly, and /me returns the user', async () => {
  const res = await json('POST', '/api/auth/login', { user_code: 'adm001', password: PASSWORD });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i);
  const me = await request('/api/auth/me', { headers: { Cookie: cookie.split(';')[0] } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).role, 'admin');
});

test('an active session is renewed; a fresh or Bearer one is left alone', async () => {
  const jwt = require('jsonwebtoken');
  const make = secondsLeft => jwt.sign({ id: 1, user_code: 'ADM001', role: 'admin', name: 'Test Admin', sv: 0, exp: Math.floor(Date.now() / 1000) + secondsLeft }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  // Less than half of the 8 hours left: /me hands back a fresh cookie with a full lifetime.
  const old = await request('/api/auth/me', { headers: { Cookie: `nnss_token=${make(3600)}` } });
  assert.equal(old.status, 200);
  const renewed = old.headers.get('set-cookie');
  assert.match(renewed, /nnss_token=/);
  assert.match(renewed, /HttpOnly/i);
  const fresh = jwt.decode(renewed.split(';')[0].split('=')[1]);
  assert.ok(fresh.exp - Math.floor(Date.now() / 1000) > 7.9 * 3600, 'renewed token should last about 8 hours');
  assert.equal(fresh.sv, 0); assert.equal(fresh.role, 'admin');
  // Plenty of time left: nothing is re-issued.
  const young = await request('/api/auth/me', { headers: { Cookie: `nnss_token=${make(7 * 3600)}` } });
  assert.equal(young.status, 200); assert.equal(young.headers.get('set-cookie'), null);
  // A Bearer token is never converted into a cookie.
  const bearer = await request('/api/auth/me', { headers: { Authorization: `Bearer ${make(3600)}` } });
  assert.equal(bearer.status, 200); assert.equal(bearer.headers.get('set-cookie'), null);
  // An expired token is still refused, and is not renewed.
  const dead = await request('/api/auth/me', { headers: { Cookie: `nnss_token=${make(-10)}` } });
  assert.equal(dead.status, 401); assert.equal(dead.headers.get('set-cookie'), null);
});

test('over-long passwords are rejected before any hashing', async () => {
  const res = await json('POST', '/api/auth/login', { user_code: 'ADM001', password: 'x'.repeat(5000) });
  assert.equal(res.status, 401);
});

test('malformed cookies no longer crash the request', async () => {
  for (const cookie of ['nnss_token=%E0%A4%A', '__proto__=polluted; nnss_token=abc', 'a=%', '=x;;;']) {
    const res = await request('/api/auth/me', { headers: { Cookie: cookie } });
    assert.equal(res.status, 401, `cookie ${JSON.stringify(cookie)} should yield 401, got ${res.status}`);
  }
  assert.equal({}.polluted, undefined);
});

test('malformed JSON gets a generic 400, not a stack trace', async () => {
  const res = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"user_code":' });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Invalid request.' });
});

test('admin routes validate IDs, dates and password length before touching the database', async () => {
  const Cookie = await adminCookie();
  const h = { Cookie };
  assert.equal((await json('PATCH', '/api/admin/sessions/abc/activate', {}, h)).status, 400);
  assert.equal((await json('PATCH', '/api/admin/terms/xyz', {}, h)).status, 400);
  assert.equal((await json('PATCH', '/api/admin/users/abc/status', { is_active: false }, h)).status, 400);
  assert.equal((await json('POST', '/api/admin/sessions', { session_name: '2030/2031', start_date: 'not-a-date' }, h)).status, 400);
  assert.equal((await json('POST', '/api/admin/sessions/1/terms', { term_number: 1, start_date: { $gt: '' } }, h)).status, 400);
  assert.equal((await json('POST', '/api/admin/users', { user_code: 'STU9001', full_name: 'Test Student', password: 'p'.repeat(100), role: 'student' }, h)).status, 400);
  assert.equal((await json('POST', '/api/admin/users', { user_code: 'STU9001', full_name: 'Test Student', password: 'long-enough-1', role: 'student', email: 'nope' }, h)).status, 400);
  assert.equal((await json('POST', '/api/admin/users', { user_code: 'STU9001', full_name: 'Test Student', password: 'long-enough-1', role: 'student', admission_no: { id: 1 } }, h)).status, 400);
});

test('database pool stringifies object parameters instead of expanding them into SQL', () => {
  // Load the real module (not the stub) just to read its pool configuration.
  const mysql = require('mysql2');
  const real = mysql.format('SELECT * FROM t WHERE a = ?', [{ id: 1 }], true);
  assert.equal(real, "SELECT * FROM t WHERE a = '[object Object]'");
  const src = require('node:fs').readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
  assert.match(src, /stringifyObjects:\s*true/);
});
