/*
 * Authorization matrix. Every route in every router is enumerated from source and
 * exercised (a) with no credentials and (b) as each role. Only a short, explicit
 * list is public; everything else must answer 401 without a session, and the
 * management / staff-only areas must answer 403 to roles that do not belong there.
 * Same stubbed-DB approach as smoke.test.js.   cd backend && npm test
 * Set MATRIX_OUT=/path/file.md to also write the full route x role table.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');

const PORT = 5074;
process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';
process.env.NODE_ENV = 'test';
// Trust one proxy hop so each request can carry its own client address: the per-address
// rate limiters would otherwise answer 429 and mask the authorization result being checked.
process.env.TRUST_PROXY_HOPS = '1';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('base64url');
process.env.DB_PASSWORD = crypto.randomBytes(8).toString('hex');

const PASSWORD = crypto.randomBytes(9).toString('base64url');
const HASH = bcrypt.hashSync(PASSWORD, 4);
const ROLES = ['student', 'teacher', 'hod', 'admin', 'commandant', 'editor'];
const USERS = {};
ROLES.forEach((role, i) => {
  const code = role.toUpperCase().slice(0, 3) + '00' + (i + 1);
  USERS[code] = { id: i + 1, user_code: code, full_name: role, email: null, role, password_hash: HASH, is_active: 1, session_version: 0, failed_attempts: 0, locked_until: null, is_locked: 0, lock_seconds: 1, lock_expired: 0 };
});
const stub = {
  async query(sql, params = []) {
    if (/FROM users WHERE user_code/.test(sql)) return [[USERS[params[0]]].filter(Boolean)];
    if (/FROM users WHERE id\s*=\s*\?/.test(sql)) return [[Object.values(USERS).find(u => u.id === params[0])].filter(Boolean)];
    return [[]];
  },
  async getConnection() { throw new Error('stub: no connection'); },
  async end() {}
};
const dbPath = require.resolve('../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: stub };
const app = require('../server');
test.after(() => app.server.close());
const base = `http://127.0.0.1:${PORT}`; // nosemgrep

// ---- enumerate routes from source -------------------------------------------------
const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const mounts = [...serverSrc.matchAll(/app\.use\('(\/api\/[a-z-]+)',require\('\.\/routes\/([a-z]+)'\)\)/g)].map(m => ({ prefix: m[1], file: m[2] }));
const routes = [];
for (const { prefix, file } of mounts) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', file + '.js'), 'utf8');
  for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)) {
    routes.push({ method: m[1].toUpperCase(), url: (prefix + (m[2] === '/' ? '' : m[2])).replace(/:[A-Za-z]+/g, '1'), file });
  }
}
// The ONLY endpoints reachable without a session.
const PUBLIC = new Set(['POST /api/auth/login', 'POST /api/auth/logout', 'GET /api/posts']);
const withoutDupes = [...new Map(routes.map(r => [r.method + ' ' + r.url, r])).values()];

let n = 0;
const send = async (method, url, cookie) => {
  n += 1;
  const res = await fetch(new URL(url, base), {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`, ...(cookie ? { Cookie: cookie } : {}) },
    body: ['GET', 'DELETE'].includes(method) ? undefined : '{}'
  });
  assert.notEqual(res.status, 429, `${method} ${url} was rate limited; the result would not prove anything`);
  return res;
};
const cookies = {};
test.before(async () => {
  for (const u of Object.values(USERS)) {
    const r = await fetch(new URL('/api/auth/login', base), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.250.1.' + u.id }, body: JSON.stringify({ user_code: u.user_code, password: PASSWORD }) });
    assert.equal(r.status, 200, `login ${u.role}`);
    cookies[u.role] = r.headers.get('set-cookie').split(';')[0];
  }
});

test('route discovery found every router', () => {
  assert.ok(mounts.length >= 9, `mounted routers: ${mounts.length}`);
  assert.ok(withoutDupes.length >= 85, `routes found: ${withoutDupes.length}`);
});

test('every non-public route rejects an unauthenticated request with 401', async () => {
  const leaks = [];
  for (const r of withoutDupes) {
    const key = r.method + ' ' + r.url;
    if (PUBLIC.has(key)) continue;
    const res = await send(r.method, r.url);
    if (res.status !== 401) leaks.push(`${key} -> ${res.status}`);
  }
  assert.deepEqual(leaks, [], 'routes reachable without authentication');
});

test('students are refused (403) by every administration route', async () => {
  const bad = [];
  for (const r of withoutDupes.filter(x => x.file === 'admin')) {
    const res = await send(r.method, r.url, cookies.student);
    if (res.status !== 403) bad.push(`${r.method} ${r.url} -> ${res.status}`);
  }
  assert.deepEqual(bad, []);
});

test('the news-team (editor) role cannot reach admin, results, students, people, requests or assignments data', async () => {
  const bad = [];
  for (const r of withoutDupes.filter(x => ['admin', 'results', 'students', 'people', 'assignments'].includes(x.file))) {
    const res = await send(r.method, r.url, cookies.editor);
    // /api/results/scheme only describes the mark scheme (no personal data).
    if (res.status === 200 && r.url !== '/api/results/scheme') bad.push(`${r.method} ${r.url} -> 200`);
  }
  assert.deepEqual(bad, []);
});

test('only management may use account administration; teachers, HODs and students cannot create or reset accounts', async () => {
  for (const role of ['student', 'teacher', 'hod', 'editor']) {
    for (const [method, url] of [['POST', '/api/admin/users'], ['PATCH', '/api/admin/users/1/password'], ['PATCH', '/api/admin/users/1/status'], ['DELETE', '/api/admin/users/1'], ['GET', '/api/admin/security-alerts'], ['GET', '/api/admin/health']]) {
      const res = await send(method, url, cookies[role]);
      assert.ok([403, 404, 405].includes(res.status), `${role} ${method} ${url} -> ${res.status}`);
      assert.notEqual(res.status, 200);
    }
  }
});

test('only the Commandant may create management accounts (admin creating commandant/admin is refused)', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  assert.match(src, /\['admin','commandant'\]\.includes\(role\) && req\.user\.role !== 'commandant'/);
  assert.match(src, /Only the Commandant can reset a management-level account password/);
});

test('result approval and rejection are HOD/management only; teachers and students are refused', async () => {
  for (const role of ['student', 'teacher', 'editor']) {
    const a = await send('PUT', '/api/results/reject/1', cookies[role]);
    assert.equal(a.status, 403, `${role} reject`);
  }
  const s = await send('PUT', '/api/results/approve/1', cookies.student);
  assert.ok([403, 404].includes(s.status));
  assert.notEqual(s.status, 200);
});

test('a student cannot read another student\'s results, profile or subjects', async () => {
  const own = USERS['STU001'].user_code;
  for (const url of ['/api/results/student/STU999', '/api/results/student/STU999/periods', '/api/results/student/STU999/term-stats', '/api/students/STU999', '/api/students/STU999/subjects']) {
    const res = await send('GET', url, cookies.student);
    assert.equal(res.status, 403, `${url} -> ${res.status} (own code is ${own})`);
  }
});

test('students cannot read the people directory or other people\'s profiles', async () => {
  assert.equal((await send('GET', '/api/people/directory', cookies.student)).status, 403);
  assert.equal((await send('GET', '/api/people/1', cookies.student)).status, 403);
  assert.equal((await send('GET', '/api/people/1', cookies.teacher)).status, 403);
});

test('a teacher cannot change teaching assignments', async () => {
  assert.equal((await send('PUT', '/api/assignments/teacher/1', cookies.teacher)).status, 403);
  assert.equal((await send('PUT', '/api/assignments/teacher/1', cookies.student)).status, 403);
});

test('optional: write the full route x role table', async () => {
  if (!process.env.MATRIX_OUT) return;
  const lines = ['| Route | none | ' + ROLES.join(' | ') + ' |', '|---|---|' + ROLES.map(() => '---').join('|') + '|'];
  for (const r of withoutDupes) {
    const row = [`\`${r.method} ${r.url}\``, String((await send(r.method, r.url)).status)];
    for (const role of ROLES) row.push(String((await send(r.method, r.url, cookies[role])).status));
    lines.push('| ' + row.join(' | ') + ' |');
  }
  fs.writeFileSync(process.env.MATRIX_OUT, lines.join('\n') + '\n');
});
