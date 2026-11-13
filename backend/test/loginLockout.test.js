/*
 * Persistent lockout, login audit, stuffing alert, health probe and the seed
 * production guard. Real Express app with an in-memory DB stub that implements
 * just enough of the lockout SQL.   cd backend && npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const bcrypt = require('bcryptjs');

const PORT = 5073;
process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('base64url');
process.env.DB_PASSWORD = crypto.randomBytes(8).toString('hex');

const PASSWORD = crypto.randomBytes(9).toString('base64url');
const HASH = bcrypt.hashSync(PASSWORD, 4);
const mk = (id, code, role) => ({ id, user_code: code, full_name: code, email: null, role, password_hash: HASH, is_active: 1, session_version: 0, failed_attempts: 0, locked_until: null });
const USERS = { ADM001: mk(1, 'ADM001', 'admin'), TCH001: mk(2, 'TCH001', 'teacher'), STU001: mk(3, 'STU001', 'student'),
  TCH002: mk(4, 'TCH002', 'teacher'), TCH003: mk(5, 'TCH003', 'teacher'), TCH004: mk(6, 'TCH004', 'teacher') };
// Each test below uses its own account: the in-memory per-address limiter (10 per account per
// 15 minutes) is the FIRST layer and would otherwise mask the database layer being tested.
const attempts = [];
const alerts = [];
let now = Date.now();
const stub = {
  async query(sql, params = []) {
    if (/FROM users WHERE user_code/.test(sql)) {
      const u = USERS[params[0]];
      if (!u) return [[]];
      const locked = u.locked_until && u.locked_until > now;
      return [[{ ...u, is_locked: locked ? 1 : 0, lock_seconds: locked ? Math.max(1, Math.ceil((u.locked_until - now) / 1000)) : 1, lock_expired: u.locked_until && u.locked_until <= now ? 1 : 0 }]];
    }
    if (/FROM users WHERE id\s*=\s*\?/.test(sql)) return [[Object.values(USERS).find(u => u.id === params[0])].filter(Boolean)];
    if (/SET locked_until = IF\(failed_attempts/.test(sql)) {
      const u = Object.values(USERS).find(x => x.id === params[2]);
      if (u.failed_attempts + 1 >= params[0]) u.locked_until = now + params[1] * 1000;
      u.failed_attempts += 1; return [{ affectedRows: 1 }];
    }
    if (/SET failed_attempts = 0, locked_until = NULL, last_login/.test(sql)) { const u = Object.values(USERS).find(x => x.id === params[0]); u.failed_attempts = 0; u.locked_until = null; return [{ affectedRows: 1 }]; }
    if (/SET failed_attempts = 0, locked_until = NULL WHERE id/.test(sql)) { const u = Object.values(USERS).find(x => x.id === params[0]); u.failed_attempts = 0; u.locked_until = null; return [{ affectedRows: 1 }]; }
    if (/INSERT INTO login_attempts/.test(sql)) { attempts.push({ ip: params[0], user_code: params[1], success: !!params[2] }); return [{ affectedRows: 1 }]; }
    if (/FROM login_attempts\s+WHERE success = 0 AND ts >=/.test(sql)) {
      const f = attempts.filter(a => !a.success);
      return [[{ failures: f.length, accounts: new Set(f.map(a => a.user_code)).size, addresses: new Set(f.map(a => a.ip)).size }]];
    }
    if (/FROM login_attempts\s+WHERE success = 0 ORDER BY/.test(sql)) return [attempts.filter(a => !a.success).map(a => ({ ...a, ts: new Date() }))];
    if (/FROM users\s+WHERE locked_until IS NOT NULL/.test(sql)) return [Object.values(USERS).filter(u => u.locked_until && u.locked_until > now)];
    if (/INSERT INTO activity_log/.test(sql)) { alerts.push(params); return [{ affectedRows: 1 }]; }
    return [[]];
  },
  async getConnection() { throw new Error('not used'); },
  async end() {}
};
const dbPath = require.resolve('../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: stub };

const app = require('../server');
const loginSecurity = require('../loginSecurity');
const base = `http://127.0.0.1:${PORT}`; // nosemgrep
test.after(() => app.server.close());
const call = (method, url, body, headers = {}) => fetch(new URL(url, base), {
  method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body)
});
const login = (code, password, ip) => call('POST', '/api/auth/login', { user_code: code, password }, ip ? { 'X-Forwarded-For': ip } : {});
const reset = () => { for (const u of Object.values(USERS)) { u.failed_attempts = 0; u.locked_until = null; } attempts.length = 0; alerts.length = 0; loginSecurity._resetForTests(); };

test('/api/health is unauthenticated, minimal, and reveals no service or database detail', async () => {
  const res = await call('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('/api/admin/health needs a signed-in management account', async () => {
  reset();
  assert.equal((await call('GET', '/api/admin/health')).status, 401);
  const student = await login('STU001', PASSWORD);
  const cookieS = student.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('GET', '/api/admin/health', undefined, { Cookie: cookieS })).status, 403);
  const admin = await login('ADM001', PASSWORD);
  const cookieA = admin.headers.get('set-cookie').split(';')[0];
  const ok = await call('GET', '/api/admin/health', undefined, { Cookie: cookieA });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).database, 'connected');
});

test('10 wrong passwords lock the account for 15 minutes, even with the right password afterwards', async () => {
  reset();
  for (let i = 0; i < 9; i++) assert.equal((await login('TCH001', 'wrong-password-' + i, `10.0.1.${i}`)).status, 401);
  assert.equal(USERS.TCH001.failed_attempts, 9);
  assert.equal((await login('TCH001', 'wrong-password-9', '10.0.1.9')).status, 401);
  assert.equal(USERS.TCH001.failed_attempts, 10);
  assert.ok(USERS.TCH001.locked_until > now, 'locked_until must be set');
  const blocked = await login('TCH001', PASSWORD, '10.0.2.1');
  assert.equal(blocked.status, 429);
  const wait = Number(blocked.headers.get('retry-after'));
  assert.ok(wait >= 1 && wait <= 900, `Retry-After ${wait}`);
  assert.equal(USERS.TCH001.failed_attempts, 10, 'attempts while locked must not extend the lock');
});

test('lockout is stored in the database, so it survives a restart', async () => {
  // The lock lives on the users row (failed_attempts / locked_until), not in process memory:
  // a freshly started server reads it back from the same row.
  reset();
  USERS.TCH002.failed_attempts = 10;
  USERS.TCH002.locked_until = now + 600 * 1000;
  assert.equal((await login('TCH002', PASSWORD, '10.0.3.1')).status, 429);
});

test('an expired lock is cleared and the next typo does not instantly re-lock', async () => {
  reset();
  USERS.TCH003.failed_attempts = 10;
  USERS.TCH003.locked_until = now - 1000;
  assert.equal((await login('TCH003', 'nope-nope-nope', '10.0.4.1')).status, 401);
  assert.equal(USERS.TCH003.failed_attempts, 1);
  assert.equal(USERS.TCH003.locked_until, null);
});

test('a successful sign-in resets the failure counter', async () => {
  reset();
  USERS.STU001.failed_attempts = 6;
  assert.equal((await login('STU001', PASSWORD, '10.0.5.1')).status, 200);
  assert.equal(USERS.STU001.failed_attempts, 0);
});

test('every attempt is written to login_attempts, including unknown accounts', async () => {
  reset();
  await login('NOSUCH1', 'whatever-123', '10.0.6.1');
  await login('STU001', 'bad-bad-bad', '10.0.6.2');
  await login('STU001', PASSWORD, '10.0.6.3');
  assert.deepEqual(attempts.map(a => [a.user_code, a.success]), [['NOSUCH1', false], ['STU001', false], ['STU001', true]]);
});

test('credential stuffing (many failures across many accounts) raises a SECURITY_ALERT once', async () => {
  reset();
  const codes = ['A1', 'B2', 'C3', 'D4', 'E5', 'F6'].map(c => 'GUESS' + c);
  for (let i = 0; i < 22; i++) await login(codes[i % codes.length], 'password-' + i, `10.9.${i}.1`);
  const summary = await loginSecurity.stuffingSummary();
  assert.equal(summary.alert, true);
  assert.equal(alerts.filter(a => a[0] === 'SECURITY_ALERT').length, 1, 'one alert per window');
});

test('failures on a single account never raise the stuffing alert', async () => {
  reset();
  for (let i = 0; i < 9; i++) await login('TCH001', 'password-' + i, `10.8.${i}.1`);
  assert.equal((await loginSecurity.stuffingSummary()).alert, false);
});

test('GET /api/admin/security-alerts is management-only', async () => {
  reset();
  const t = await login('TCH004', PASSWORD, '10.7.0.1');
  const ct = t.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('GET', '/api/admin/security-alerts', undefined, { Cookie: ct })).status, 403);
  const a = await login('ADM001', PASSWORD, '10.7.0.2');
  const ca = a.headers.get('set-cookie').split(';')[0];
  const res = await call('GET', '/api/admin/security-alerts', undefined, { Cookie: ca });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.summary && Array.isArray(body.recent_failures) && Array.isArray(body.locked_accounts));
});

test('demo/test seed scripts refuse to run when NODE_ENV=production', () => {
  for (const script of ['seed-demo.js', 'test-seed.js']) {
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'database', script)], {
      env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8', timeout: 20000
    });
    assert.equal(r.status, 1, `${script} must exit 1 in production`);
    assert.match(r.stderr, /Refusing to run/);
  }
});
