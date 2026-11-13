/*
 * /api/results/ai-status is cached for 30 seconds so a polling client cannot make
 * the server spawn the OCR runner over and over.   cd backend && npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const bcrypt = require('bcryptjs');

const PORT = 5074;
process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('base64url');
process.env.DB_PASSWORD = crypto.randomBytes(8).toString('hex');
process.env.AI_SCORE_IMPORT_ENABLED = 'true';

// Stub child_process.spawn BEFORE the app (and routes/results.js, which destructures it) loads.
let spawnCalls = 0;
let spawnExit = 0;
childProcess.spawn = () => {
  spawnCalls += 1;
  const child = new EventEmitter();
  child.kill = () => {};
  setImmediate(() => child.emit('close', spawnExit));
  return child;
};

const PASSWORD = crypto.randomBytes(9).toString('base64url');
const HASH = bcrypt.hashSync(PASSWORD, 4);
const USERS = {
  TCH001: { id: 2, user_code: 'TCH001', full_name: 'Test Teacher', email: null, role: 'teacher', password_hash: HASH, is_active: 1, session_version: 0 },
  ADM001: { id: 1, user_code: 'ADM001', full_name: 'Test Admin', email: null, role: 'admin', password_hash: HASH, is_active: 1, session_version: 0 }
};
const stub = {
  async query(sql, params = []) {
    if (/FROM users WHERE user_code/.test(sql)) return [[USERS[params[0]]].filter(Boolean)];
    if (/FROM users WHERE id\s*=\s*\?/.test(sql)) return [[Object.values(USERS).find(u => u.id === params[0])].filter(Boolean)];
    if (/UPDATE users SET last_login/.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  },
  async getConnection() { throw new Error('not expected'); },
  async end() {}
};
const dbPath = require.resolve('../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: stub };

const app = require('../server');
const base = `http://127.0.0.1:${PORT}`; // nosemgrep
const request = (route, init) => fetch(new URL(route, base), init);
test.after(() => app.server.close());
async function cookieFor(code) {
  const res = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_code: code, password: PASSWORD }) });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}
const status = cookie => request('/api/results/ai-status', { headers: { Cookie: cookie } });
const realNow = Date.now;
test.afterEach(() => { Date.now = realNow; });

test('only teachers may probe, and a refused request spawns nothing', async () => {
  const admin = await cookieFor('ADM001');
  assert.equal((await status(admin)).status, 403);
  assert.equal(spawnCalls, 0);
});

test('two consecutive calls spawn the runner at most twice in total (Tesseract + pypdfium2), not four times', async () => {
  const cookie = await cookieFor('TCH001');
  spawnCalls = 0;
  const a = await status(cookie); const b = await status(cookie);
  assert.deepEqual(await a.json(), { enabled: true, available: true, pdf: true, model: 'Tesseract OCR' });
  assert.deepEqual(await b.json(), { enabled: true, available: true, pdf: true, model: 'Tesseract OCR' });
  assert.equal(spawnCalls, 2, `expected 2 spawns for 2 calls, saw ${spawnCalls}`);
});

test('the cache expires after 30 seconds and the probe runs again (and reports "unavailable" when Tesseract fails)', async () => {
  const cookie = await cookieFor('TCH001');
  const t0 = Date.now();
  spawnCalls = 0; spawnExit = 1; // Tesseract check now fails
  Date.now = () => t0 + 29 * 1000;
  assert.equal((await (await status(cookie)).json()).available, true, 'still inside the 30 s cache: old answer');
  assert.equal(spawnCalls, 0);
  Date.now = () => t0 + 31 * 1000;
  const fresh = await (await status(cookie)).json();
  assert.deepEqual(fresh, { enabled: true, available: false, pdf: false, model: 'Tesseract OCR' });
  assert.equal(spawnCalls, 1, 'one spawn: the first probe failed so the PDF probe is skipped');
  await status(cookie);
  assert.equal(spawnCalls, 1, 'the failure is cached too');
});
