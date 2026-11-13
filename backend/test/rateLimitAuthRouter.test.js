/*
 * /api/auth/me has its own budget, separate from the sign-in router limiter,
 * so quick navigation (screen restore calls /me every time) cannot lock a
 * teacher out of authentication.   cd backend && npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const PORT = 5073;
process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('base64url');
process.env.DB_PASSWORD = crypto.randomBytes(8).toString('hex');

const stub = { async query() { return [[]]; }, async getConnection() { throw new Error('not expected'); }, async end() {} };
const dbPath = require.resolve('../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: stub };

const app = require('../server');
const base = `http://127.0.0.1:${PORT}`; // nosemgrep
const request = (route, init) => fetch(new URL(route, base), init);
test.after(() => app.server.close());
const post = (url, body) => request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('more than 120 /me calls do not use up the sign-in budget (login is not rejected by the auth-router limiter)', async () => {
  // 125 > the 120/15 min sign-in-router budget. Unauthenticated /me is a cheap 401, which is all we need to count requests.
  for (let i = 0; i < 125; i++) {
    const res = await request('/api/auth/me');
    assert.equal(res.status, 401, `/me call ${i + 1} should be a plain 401, not a rate-limit`);
  }
  const login = await post('/api/auth/login', { user_code: 'NOBODY1', password: 'wrong-password-1' });
  assert.equal(login.status, 401, 'login must still reach the handler (a wrong password is 401, not 429)');
  assert.doesNotMatch(JSON.stringify(await login.json()), /Too many/);
});

test('/me has its own 300-per-15-minutes counter and the other auth routes keep the 120 budget', async () => {
  // Draining the auth-router budget with another path must be 429 at the 121st request ...
  // (logout is used because it is cheap and needs no database). 5 requests were already spent by the login above? No: login
  // is counted by this router too, so allow for the one login call made in the previous test.
  let first429 = null;
  for (let i = 1; i <= 125; i++) {
    const res = await post('/api/auth/logout', {});
    if (res.status === 429) { first429 = i; assert.match((await res.json()).error, /Too many authentication requests/); break; }
  }
  assert.ok(first429 !== null, 'the sign-in router limiter must still stop at 120');
  assert.ok(first429 >= 118 && first429 <= 121, `expected the limit to trip at about request 120, tripped at ${first429}`);
  // ... and /me is unaffected by that exhausted counter.
  const me = await request('/api/auth/me');
  assert.equal(me.status, 401, '/me still answers while the sign-in budget is used up');
});
