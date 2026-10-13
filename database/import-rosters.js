#!/usr/bin/env node
/*
 * NNSS Calabar - import class rosters (students) from a JSON file.
 *
 * Built for the scanned Continuous Assessment Sheets: they list each class's
 * students but carry no scores, so this loads the students (and the term the
 * sheet belongs to) so teachers can then enter or scan the scores in the portal.
 *
 *   node database/import-rosters.js                     dry run (default) - shows what would change
 *   node database/import-rosters.js --apply             write to the database
 *
 * Options:
 *   --roster <file>        roster JSON (default database/rosters/2025-2026-second-term.json)
 *   --credentials <file>   where to save the generated temporary passwords
 *                          (default database/.imported-credentials.csv, git-ignored, mode 0600)
 *   --mirror-assignments   also copy teaching assignments for these classes from the
 *                          current session into the roster's session, so teachers can open
 *                          that session's sheets (off by default)
 *
 * Safe to re-run: a student already in the class + arm (same name) is skipped, the
 * session and term are only created when missing, and the current session is never changed.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('../backend/node_modules/mysql2/promise');
const bcrypt = require('../backend/node_modules/bcryptjs');
require('../backend/node_modules/dotenv').config({ path: path.join(__dirname, '..', 'backend', '.env') });

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };

const APPLY = flag('--apply');
const MIRROR = flag('--mirror-assignments');
const ROSTER_FILE = path.resolve(option('--roster', path.join(__dirname, 'rosters', '2025-2026-second-term.json')));
const CREDENTIALS_FILE = path.resolve(option('--credentials', path.join(__dirname, '.imported-credentials.csv')));

const normalise = s => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
const csv = v => `"${String(v).replace(/"/g, '""')}"`;
// Unambiguous characters only (no 0/O, 1/l/I) so a password read off a printout is typed correctly.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function tempPassword(length = 10) {
  let out = '';
  while (out.length < length) { const b = crypto.randomBytes(1)[0]; if (b < 256 - (256 % ALPHABET.length)) out += ALPHABET[b % ALPHABET.length]; }
  return out;
}

function loadRoster(file) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`Cannot read roster file ${file}: ${e.message}`); }
  if (!data.session || !Number.isInteger(data.term_number) || !data.term_name || !Array.isArray(data.classes)) throw new Error('Roster file needs session, term_number, term_name and classes.');
  for (const c of data.classes) {
    if (!c.class || !c.arm || !c.code_prefix || !Array.isArray(c.students)) throw new Error('Each class needs class, arm, code_prefix and students.');
    if (!/^[A-Z0-9]{2,14}$/.test(c.code_prefix)) throw new Error(`code_prefix "${c.code_prefix}" must be 2-14 capital letters/digits.`);
    if (c.expected_count !== undefined && c.expected_count !== c.students.length) throw new Error(`${c.class} ${c.arm}: expected ${c.expected_count} students but the file lists ${c.students.length}.`);
    const seen = new Set();
    for (const name of c.students) {
      const key = normalise(name);
      if (key.length < 3 || key.length > 120) throw new Error(`${c.class} ${c.arm}: invalid name "${name}".`);
      if (seen.has(key)) throw new Error(`${c.class} ${c.arm}: "${name}" is listed twice.`);
      seen.add(key);
    }
  }
  return data;
}

async function main() {
  const roster = loadRoster(ROSTER_FILE);
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, charset: 'utf8mb4'
  });
  const report = { session: 'exists', term: 'exists', created: [], skipped: [], assignments: 0, credentials: [] };

  try {
    await conn.beginTransaction();

    // ---- session + term (never touches is_current) -------------------------
    let [[session]] = await conn.query('SELECT id FROM academic_sessions WHERE session_name=? LIMIT 1', [roster.session]);
    if (!session) {
      const m = /^(\d{4})\/(\d{4})$/.exec(roster.session);
      if (!m || Number(m[2]) !== Number(m[1]) + 1) throw new Error(`Session "${roster.session}" is missing and its name is not in the form 2025/2026, so it cannot be created.`);
      const [r] = await conn.query('INSERT INTO academic_sessions (session_name, is_current, start_date, end_date) VALUES (?, 0, ?, ?)', [roster.session, `${m[1]}-09-01`, `${m[2]}-07-31`]);
      session = { id: r.insertId }; report.session = 'created';
    }
    let [[term]] = await conn.query('SELECT id, result_locked FROM terms WHERE session_id=? AND term_number=? LIMIT 1', [session.id, roster.term_number]);
    if (!term) {
      const [r] = await conn.query('INSERT INTO terms (session_id, term_number, term_name, is_current, result_locked) VALUES (?, ?, ?, 0, 0)', [session.id, roster.term_number, roster.term_name]);
      term = { id: r.insertId, result_locked: 0 }; report.term = 'created';
    }

    // ---- students ------------------------------------------------------------
    for (const c of roster.classes) {
      const [[level]] = await conn.query('SELECT id, is_junior FROM class_levels WHERE level_name=? LIMIT 1', [c.class]);
      const [[arm]] = await conn.query('SELECT id, arm_type FROM arms WHERE arm_name=? LIMIT 1', [c.arm]);
      if (!level) throw new Error(`Class "${c.class}" does not exist. Create it under Classes & Arms first.`);
      if (!arm) throw new Error(`Arm "${c.arm}" does not exist. Create it under Classes & Arms first.`);
      // Same rule the portal uses when it creates a student: junior classes are the junior track,
      // senior classes follow the arm (science / technical / arts).
      const track = level.is_junior ? 'junior' : arm.arm_type;

      const [existing] = await conn.query(`SELECT u.full_name FROM students s JOIN users u ON u.id=s.user_id WHERE s.class_level_id=? AND s.arm_id=?`, [level.id, arm.id]);
      const have = new Set(existing.map(r => normalise(r.full_name)));
      const [codes] = await conn.query('SELECT user_code FROM users WHERE user_code LIKE ?', [`${c.code_prefix}%`]);
      const used = new Set(codes.map(r => r.user_code));
      let counter = 0;
      const nextCode = () => { let code; do { counter += 1; code = `${c.code_prefix}${String(counter).padStart(2, '0')}`; } while (used.has(code)); used.add(code); return code; };

      for (const name of c.students) {
        if (have.has(normalise(name))) { report.skipped.push(`${c.class} ${c.arm}: ${name}`); continue; }
        const code = nextCode();
        const password = tempPassword();
        const [u] = await conn.query(`INSERT INTO users (user_code, full_name, password_hash, role, is_active) VALUES (?, ?, ?, 'student', 1)`, [code, normalise(name), await bcrypt.hash(password, 12)]);
        const [s] = await conn.query(`INSERT INTO students (user_id, class_level_id, arm_id, track, status) VALUES (?, ?, ?, ?, 'active')`, [u.insertId, level.id, arm.id, track]);
        await conn.query(`INSERT IGNORE INTO student_subject_enrollment (student_id, subject_id, session_id) SELECT ?, ts.subject_id, ? FROM track_subjects ts WHERE ts.track=?`, [s.insertId, session.id, track]);
        report.created.push(`${c.class} ${c.arm}: ${normalise(name)} -> ${code}`);
        report.credentials.push([code, normalise(name), c.class, c.arm, password]);
      }

      if (MIRROR) {
        const [r] = await conn.query(`INSERT IGNORE INTO teacher_class_assignments (teacher_id, subject_id, class_level_id, arm_id, session_id)
          SELECT tca.teacher_id, tca.subject_id, tca.class_level_id, tca.arm_id, ?
          FROM teacher_class_assignments tca JOIN academic_sessions cur ON cur.id=tca.session_id AND cur.is_current=1
          WHERE tca.class_level_id=? AND tca.arm_id=?`, [session.id, level.id, arm.id]);
        report.assignments += r.affectedRows;
      }
    }

    if (APPLY) await conn.commit(); else await conn.rollback();
  } catch (err) {
    try { await conn.rollback(); } catch { /* nothing to roll back */ }
    throw err;
  } finally {
    await conn.end();
  }

  console.log(`${APPLY ? 'APPLIED' : 'DRY RUN (nothing written - add --apply to save)'}  roster: ${path.relative(process.cwd(), ROSTER_FILE)}`);
  console.log(`Session ${roster.session}: ${report.session}.  ${roster.term_name}: ${report.term}.`);
  console.log(`Students ${APPLY ? 'created' : 'to create'}: ${report.created.length}   already present (skipped): ${report.skipped.length}`);
  if (MIRROR) console.log(`Teaching assignments ${APPLY ? 'copied' : 'to copy'}: ${report.assignments}`);
  if (APPLY && report.credentials.length) {
    const lines = ['user_code,full_name,class,arm,temporary_password', ...report.credentials.map(r => r.map(csv).join(','))];
    fs.writeFileSync(CREDENTIALS_FILE, `${lines.join('\n')}\n`, { mode: 0o600 });
    try { fs.chmodSync(CREDENTIALS_FILE, 0o600); } catch { /* best effort on filesystems without modes */ }
    console.log(`Temporary passwords saved to ${CREDENTIALS_FILE} (private, git-ignored). Hand them out, then delete the file.`);
  }
}

main().catch(err => { console.error(`Import failed: ${err.message}`); process.exit(1); });
