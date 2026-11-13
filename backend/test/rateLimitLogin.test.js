/*
 * Retry-After on the login throttle and the password-change guard.
 * Same approach as smoke.test.js: the real Express app with an in-memory
 * database stub, no MySQL needed.   cd backend && npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const PORT = 5072;
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
const base = `http://127.0.0.1:${PORT}`; // nosemgrep
const request = (route, init) => fetch(new URL(route, base), init);
test.after(() => app.server.close());
const json = (method, url, body, headers = {}) =>
  request(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

const realNow = Date.now;
test.afterEach(() => { Date.now = realNow; });

test('login throttle: the 11th attempt for one account is 429 with an integer Retry-After of 1-900 seconds', async () => {
  for (let i = 1; i <= 10; i++) {
    const res = await json('POST', '/api/auth/login', { user_code: 'THROTTLE1', password: 'wrong-password-1' });
    assert.equal(res.status, 401, `attempt ${i} should be a normal wrong-password 401`);
    assert.equal(res.headers.get('retry-after'), null, 'allowed attempts carry no Retry-After');
  }
  const res = await json('POST', '/api/auth/login', { user_code: 'THROTTLE1', password: 'wrong-password-1' });
  assert.equal(res.status, 429);
  const retry = res.headers.get('retry-after');
  assert.match(retry, /^\d+$/, 'Retry-After is whole seconds');
  assert.ok(Number(retry) >= 1 && Number(retry) <= 900, `Retry-After ${retry} must be within the 15-minute window`);
  assert.match((await res.json()).error, /Too many login attempts/);
  // A different account from the same address is not locked by this one.
  const other = await json('POST', '/api/auth/login', { user_code: 'THROTTLE2', password: 'wrong-password-1' });
  assert.equal(other.status, 401);
});

test('fixed window, not sliding: further blocked attempts never push Retry-After up; it shrinks as time passes', async () => {
  const seen = [];
  const attempt = async () => {
    const res = await json('POST', '/api/auth/login', { user_code: 'THROTTLE3', password: 'wrong-password-1' });
    return res;
  };
  for (let i = 0; i < 10; i++) await attempt();
  for (let i = 0; i < 3; i++) {
    const res = await attempt();
    assert.equal(res.status, 429);
    seen.push(Number(res.headers.get('retry-after')));
  }
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] <= seen[i - 1], `Retry-After grew: ${seen.join(', ')}`);
  // Jump the clock forward 5 minutes: the remaining wait must drop by about 300 s, not restart.
  const start = Date.now();
  Date.now = () => start + 5 * 60 * 1000;
  const later = await attempt();
  assert.equal(later.status, 429);
  const drop = seen[0] - Number(later.headers.get('retry-after'));
  assert.ok(drop >= 298 && drop <= 302, `expected ~300 s less to wait, got ${drop} (${seen[0]} -> ${later.headers.get('retry-after')})`);
  // After the window closes the counter clears and the account can try again.
  Date.now = () => start + 16 * 60 * 1000;
  assert.equal((await attempt()).status, 401);
});

test('password change: the 11th attempt in a window is 429 with Retry-After', async () => {
  const login = await json('POST', '/api/auth/login', { user_code: 'ADM001', password: PASSWORD });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const body = { current_password: 'not-the-password-1', new_password: 'Brand-new-pass-1' };
  for (let i = 1; i <= 10; i++) {
    const res = await json('PATCH', '/api/auth/password', body, { Cookie: cookie });
    assert.equal(res.status, 401, `attempt ${i}: wrong current password`);
  }
  const blocked = await json('PATCH', '/api/auth/password', body, { Cookie: cookie });
  assert.equal(blocked.status, 429);
  const retry = blocked.headers.get('retry-after');
  assert.match(retry, /^\d+$/);
  assert.ok(Number(retry) >= 1 && Number(retry) <= 900, `Retry-After ${retry}`);
});

test('password change: validation still runs before the throttle (order unchanged)', async () => {
  const login = await json('POST', '/api/auth/login', { user_code: 'ADM001', password: PASSWORD });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  // Account is already throttled by the previous test, but a malformed request must still be a 400, not a 429.
  const res = await json('PATCH', '/api/auth/password', { current_password: 'x' }, { Cookie: cookie });
  assert.equal(res.status, 400);
});
