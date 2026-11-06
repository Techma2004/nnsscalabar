#!/usr/bin/env node
'use strict';
/*
 * End-to-end check of the whole results journey, through the real HTTP API:
 *
 *   admin creates an HOD and a teacher  ->  teacher fills a score sheet
 *   ->  HOD approves it  ->  a student signs in and sees the result
 *   (session/term pickers, report-card statistics, privacy rules)
 *
 * It only ever ADDS clearly named accounts (E2EHOD..., E2ETCH...) and results; point it
 * at a throwaway database, never at the school's live one.
 *
 *   BASE=http://127.0.0.1:5077 ADMIN_CODE=ADM001 ADMIN_PASSWORD=... \
 *   STUDENT_CODE=SS1SIRI01 STUDENT_PASSWORD=... node backend/test/e2e-portal.js
 *
 * TERM_SESSION / TERM_NAME pick an older term (default: the current term); for a past session the
 * teacher needs that session's assignments (database/import-rosters.js --mirror-assignments) and
 * REUSE_TEACHER=<code> reuses a teacher made by an earlier run.
 * CLASS / ARM / SUBJECT choose the class that has students (default JSS3 / AYAM / English Language,
 * which is what database/import-rosters.js loads). STUDENT_* is optional: without it the
 * script resets the password of the first student on the sheet for the test.
 */
const BASE = process.env.BASE || 'http://127.0.0.1:5077';
const ADMIN = { user_code: process.env.ADMIN_CODE || 'ADM001', password: process.env.ADMIN_PASSWORD || '' };
const PW = 'E2e-Pass#2026';
const CLASS = process.env.CLASS || 'JSS3', ARM = process.env.ARM || 'AYAM', SUBJECT = process.env.SUBJECT || 'English Language';
const RUN = Date.now().toString(36).toUpperCase().slice(-5);

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n      ${detail}`}`); if (!ok) failed += 1; };

class Client {
  constructor(label) { this.label = label; this.cookie = ''; }
  async call(method, path, body) {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: BASE, ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const set = res.headers.getSetCookie?.() || [];
    const tok = set.map(c => c.split(';')[0]).find(c => c.startsWith('nnss_token='));
    if (tok) this.cookie = tok;
    let data = null; try { data = await res.json(); } catch { /* no body */ }
    return { status: res.status, data };
  }
  async login(user_code, password) { const r = await this.call('POST', '/api/auth/login', { user_code, password }); return r; }
}

(async () => {
  // ---- admin ---------------------------------------------------------------
  const admin = new Client('admin');
  const al = await admin.login(ADMIN.user_code, ADMIN.password);
  check('admin can sign in', al.status === 200, JSON.stringify(al.data));
  if (al.status !== 200) process.exit(1);

  const subjects = (await admin.call('GET', '/api/admin/subjects')).data;
  const depts = (await admin.call('GET', '/api/admin/departments')).data;
    const sub = (Array.isArray(subjects) ? subjects : subjects.rows || []).find(s => s.is_active && s.dept_id && s.subject_name === SUBJECT);
  check(`subject "${SUBJECT}" exists and belongs to a department`, !!sub);
  if (!sub) process.exit(1);
  const deptList = Array.isArray(depts) ? depts : depts.rows || [];
  const dept = deptList.find(d => d.id === sub.dept_id) || {};

  const hodCode = `E2EHOD${RUN}`, tchCode = `E2ETCH${RUN}`;
  const mk = (role, code, extra) => admin.call('POST', '/api/admin/users', { user_code: code, full_name: `${role.toUpperCase()} E2E ${RUN}`, password: PW, role, phone: '08012345678', gender: 'M', ...extra });
  const findUser = async q => { const l = (await admin.call('GET', `/api/admin/users?q=${encodeURIComponent(q)}`)).data; return (l.rows || []).filter(x => x.user_code.startsWith(q)); };
  const resetPw = async u => (await admin.call('PATCH', `/api/admin/users/${u.user_id}/password`, { new_password: PW })).status === 200;
  let hodLogin = hodCode;
  const hodRes = await mk('hod', hodCode, { dept_id: sub.dept_id, department: dept.dept_name });
  if (hodRes.status === 409 || /already exists/.test(JSON.stringify(hodRes.data))) {
    // A department has one HOD. When an earlier run of this script already made it, reuse that one
    // (and only that one: never take over a real HOD's account).
    const cur = (await admin.call('GET', '/api/admin/departments')).data.find(d => d.id === sub.dept_id);
    const old = cur?.hod_code?.startsWith('E2EHOD') ? (await findUser(cur.hod_code)).find(x => x.user_code === cur.hod_code) : null;
    check('department already has an E2E HOD from an earlier run: reusing it', !!old && await resetPw(old), `${dept.dept_name} has a real HOD (${cur?.hod_code}); run this on a throwaway database`);
    if (old) hodLogin = old.user_code;
  } else check('admin creates an HOD', hodRes.status === 201 || hodRes.status === 200, JSON.stringify(hodRes.data));
  let tchLogin = tchCode;
  if (process.env.REUSE_TEACHER) {
    const u = (await findUser(process.env.REUSE_TEACHER)).find(x => x.user_code === process.env.REUSE_TEACHER);
    check(`reusing teacher ${process.env.REUSE_TEACHER}`, !!u && await resetPw(u)); tchLogin = process.env.REUSE_TEACHER;
  }
  const tchRes = process.env.REUSE_TEACHER ? { status: 200 } : await mk('teacher', tchCode, { dept_id: sub.dept_id, department: dept.dept_name, subjects: [sub.subject_name], assignment_mode: 'specific', assignments: [{ subject: sub.subject_name, class_level: CLASS, arm: ARM }] });
  check(`admin creates a teacher for ${CLASS} ${ARM} ${sub.subject_name}`, tchRes.status === 201 || tchRes.status === 200, JSON.stringify(tchRes.data));

  // ---- teacher fills a sheet ------------------------------------------------
  const teacher = new Client('teacher');
  check('teacher can sign in', (await teacher.login(tchLogin, PW)).status === 200);
  const assigns = (await teacher.call('GET', '/api/results/assignments')).data || [];
  check('teacher has assignments', assigns.length > 0);
  const term = (await admin.call('GET', '/api/admin/sessions')).data;
  const sessions = Array.isArray(term) ? term : term.rows || term.sessions || [];
  const current = process.env.TERM_SESSION ? sessions.find(s => s.session_name === process.env.TERM_SESSION) : (sessions.find(s => s.is_current) || sessions[0]);
  const termRow = process.env.TERM_NAME ? (current?.terms || []).find(t => t.term_name === process.env.TERM_NAME) : ((current?.terms || []).find(t => t.is_current) || (current?.terms || [])[0]);
  check('there is a current term', !!termRow);

  let chosen = null; let sheet = null;
  for (const a of assigns) {
    const r = await teacher.call('GET', `/api/results/sheet?term_id=${termRow.id}&assignment_id=${a.id}`);
    if (r.status === 200 && (r.data.students || []).length) { chosen = a; sheet = r.data; break; }
  }
  check('a class with students is on the teacher\'s sheet', !!chosen, chosen ? '' : 'no assignment had a roster; import a roster or add students first');
  if (!chosen) process.exit(1);
  const roster = sheet.students;
  const rows = roster.map((s, i) => ({ student_code: s.user_code || s.student_code, test1: 4, quiz: 3, assignment: 5, test2: 4, project: 3, note: 5, exam: 40 + (i % 25) }));
  const save = await teacher.call('POST', '/api/results/sheet', { term_id: termRow.id, assignment_id: chosen.id, rows });
  check(`teacher saves ${rows.length} scores`, save.status === 200 && save.data.saved === rows.length, JSON.stringify(save.data));

  // ---- the student must NOT see them yet -----------------------------------
  const sCode = process.env.STUDENT_CODE || rows[0].student_code;
  const sPass = process.env.STUDENT_PASSWORD;
  let student = new Client('student');
  let studentCode = sCode;
  if (!sPass) {
    // No credentials supplied: reset this student's password through the admin API for the test.
    const u = (await findUser(sCode)).find(x => x.user_code === sCode);
    check('student account found', !!u && await resetPw(u));
  }
  const sl = await student.login(studentCode, sPass || PW);
  check('student can sign in', sl.status === 200, JSON.stringify(sl.data));
  const before = await student.call('GET', `/api/results/student/${studentCode}`);
  check('before approval the student sees no result for this subject', before.status === 200 && !before.data.some(r => r.subject_name === chosen.subject_name), JSON.stringify(before.data).slice(0, 160));

  // ---- HOD approves ------------------------------------------------------------
  const hod = new Client('hod');
  check('HOD can sign in', (await hod.login(hodLogin, PW)).status === 200);
  const pend = await hod.call('GET', '/api/results/pending');
  check('HOD sees the sheet waiting for approval', pend.status === 200 && JSON.stringify(pend.data).includes(chosen.subject_name), JSON.stringify(pend.data).slice(0, 160));
  const appr = await hod.call('PUT', '/api/results/approve-sheet', { subject_id: chosen.subject_id, class_level_id: chosen.class_level_id, arm_id: chosen.arm_id, term_id: termRow.id });
  check('HOD approves the whole sheet', appr.status === 200 && appr.data.approved === rows.length, JSON.stringify(appr.data));

  // ---- the student now sees it ----------------------------------------------------
  const after = await student.call('GET', `/api/results/student/${studentCode}`);
  const mine = (after.data || []).find(r => r.subject_name === chosen.subject_name);
  check('after approval the student sees the result', !!mine, JSON.stringify(after.data).slice(0, 200));
  check('total = CA + exam and the grade is filled', !!mine && Number(mine.total_score) === Number(mine.ca_score) + Number(mine.exam_score) && !!mine.grade, JSON.stringify(mine));
  const per = await student.call('GET', `/api/results/student/${studentCode}/periods`);
  const flat = (per.data.sessions || []).flatMap(s => s.terms.map(t => ({ s: s.session_name, t: t.term_name, has: t.has_results })));
  check('periods lists the term as having results', flat.some(x => x.s === mine?.session_name && x.t === mine?.term_name && x.has), JSON.stringify(per.data).slice(0, 200));
  check('default period opens on that term', per.data.default?.session_name === mine?.session_name && per.data.default?.term_name === mine?.term_name, JSON.stringify(per.data.default));
  const ts = await student.call('GET', `/api/results/student/${studentCode}/term-stats`);
  const t0 = (ts.data.terms || [])[0];
  check('report-card statistics are returned (position, average, comment)', ts.status === 200 && !!t0 && !!t0.comment && t0.stats && Object.keys(t0.stats.subjects || {}).length > 0, JSON.stringify(ts.data).slice(0, 220));

  // ---- privacy -----------------------------------------------------------------------
  const other = roster.map(s => s.user_code || s.student_code).find(c => c !== studentCode);
  if (other) {
    check('a student cannot read another student\'s results', (await student.call('GET', `/api/results/student/${other}`)).status === 403);
    check('a student cannot read another student\'s periods', (await student.call('GET', `/api/results/student/${other}/periods`)).status === 403);
  }
  check('a signed-out visitor is refused', (await new Client('anon').call('GET', `/api/results/student/${studentCode}`)).status === 401);

  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll end-to-end checks passed');
  console.log(`Test student: ${studentCode}  (${mine?.session_name} / ${mine?.term_name})`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2); });
