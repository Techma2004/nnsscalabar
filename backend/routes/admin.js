const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const auth = require('../middleware/auth');
const router = express.Router();

const ROLES = ['student', 'teacher', 'hod', 'admin', 'commandant'];
const TRACKS = ['junior', 'science', 'technical', 'arts'];

function requireManagement(req, res, next) {
  if (!['admin', 'commandant'].includes(req.user.role)) return res.status(403).json({ error: 'Management access required.' });
  next();
}
function requireStaffDirectory(req, res, next) {
  if (!['admin', 'commandant', 'hod'].includes(req.user.role)) return res.status(403).json({ error: 'Staff directory access required.' });
  next();
}
// School configuration (classes, arms, departments, subjects, sessions, terms) is
// non-sensitive reference data that teachers and HODs also need — e.g. teachers must
// read the term list to enter scores. Only account management endpoints below stay
// restricted to admin/commandant via requireManagement.
function requireStaffReference(req, res, next) {
  if (!['admin', 'commandant', 'hod', 'teacher'].includes(req.user.role)) return res.status(403).json({ error: 'Staff access required.' });
  next();
}
router.use(auth);

router.get('/meta', requireStaffReference, async (req, res) => {
  try {
    const [[classes], [arms], [departments], [subjects], [sessions], [terms]] = await Promise.all([
      db.query('SELECT id, level_name, is_junior FROM class_levels ORDER BY sort_order, id'),
      db.query('SELECT id, arm_name, arm_type, category FROM arms WHERE is_active = 1 ORDER BY arm_name'),
      db.query('SELECT id, dept_name FROM departments ORDER BY dept_name'),
      db.query('SELECT id, subject_name, dept_id, ca_max, exam_max FROM subjects WHERE is_active = 1 ORDER BY subject_name'),
      db.query('SELECT id, session_name, is_current FROM academic_sessions ORDER BY start_date DESC'),
      db.query(`SELECT t.id, t.term_name, t.term_number, t.session_id, t.is_current, t.result_locked, a.session_name
                FROM terms t JOIN academic_sessions a ON a.id=t.session_id ORDER BY a.start_date DESC, t.term_number`)
    ]);
    res.json({ classes, arms, departments, subjects, sessions, terms });
  } catch (err) {
    console.error('[admin/meta]', err); res.status(500).json({ error: 'Unable to load school configuration.' });
  }
});

router.post('/users', requireManagement, async (req, res) => {
  const body = req.body || {};
  const user_code = String(body.user_code || '').trim().toUpperCase();
  const password = String(body.password || '');
  const full_name = String(body.full_name || '').trim();
  const role = String(body.role || '').toLowerCase();
  const email = body.email ? String(body.email).trim().toLowerCase() : null;
  const gender = body.gender || null;

  if (!/^[A-Z0-9][A-Z0-9_-]{2,19}$/.test(user_code)) return res.status(400).json({ error: 'User ID must be 3–20 characters using letters, numbers, _ or -.' });
  if (!full_name || full_name.length < 3) return res.status(400).json({ error: 'Full name is required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid account role.' });
  if (['admin','commandant'].includes(role) && req.user.role !== 'commandant') return res.status(403).json({ error: 'Only the Commandant can create management-level accounts.' });
  if (gender && !['M', 'F'].includes(gender)) return res.status(400).json({ error: 'Invalid gender.' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query('SELECT id FROM users WHERE user_code = ? OR (email IS NOT NULL AND email = ?) LIMIT 1', [user_code, email]);
    if (existing.length) { await conn.rollback(); return res.status(409).json({ error: 'User ID or email already exists.' }); }

    const password_hash = await bcrypt.hash(password, 12);
    const [userResult] = await conn.query(
      `INSERT INTO users (user_code, full_name, email, password_hash, role, gender, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [user_code, full_name, email, password_hash, role, gender]
    );
    const userId = userResult.insertId;

    if (role === 'student') {
      const classLevel = String(body.class_level || '').toUpperCase();
      const arm = String(body.arm || '').toUpperCase();
      const track = String(body.track || '').toLowerCase();
      if (!classLevel || !arm || !TRACKS.includes(track)) throw new Error('Student requires a valid class, arm and track.');
      const [[classRow], [armRow]] = await Promise.all([
        conn.query('SELECT id FROM class_levels WHERE level_name = ? LIMIT 1', [classLevel]),
        conn.query('SELECT id FROM arms WHERE arm_name = ? LIMIT 1', [arm])
      ]);
      if (!classRow.length || !armRow.length) throw new Error('Invalid class or arm.');
      const [studentInsert] = await conn.query(`INSERT INTO students (user_id, admission_no, class_level_id, arm_id, track, is_boarder) VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, body.admission_no || null, classRow[0].id, armRow[0].id, track, body.is_boarder ? 1 : 0]);
      const [[currentSession]] = await conn.query('SELECT id FROM academic_sessions WHERE is_current=1 ORDER BY start_date DESC LIMIT 1');
      if (currentSession) {
        await conn.query(`INSERT INTO student_subject_enrollment(student_id,subject_id,session_id,enrolled_by)
          SELECT ?,ts.subject_id,?,? FROM track_subjects ts WHERE ts.track=?`, [studentInsert.insertId,currentSession.id,req.user.id,track]);
      }
    }

    if (role === 'teacher' || role === 'hod') {
      // Accept either a department id (preferred) or a department name for backward compatibility.
      const rawDepartment = body.department_id ?? body.department;
      const department = String(rawDepartment ?? '').trim();
      let deptRow;
      if (/^\d+$/.test(department)) {
        [[deptRow]] = await conn.query('SELECT id, dept_name FROM departments WHERE id = ? LIMIT 1', [Number(department)]);
      } else {
        [[deptRow]] = await conn.query('SELECT id, dept_name FROM departments WHERE LOWER(TRIM(dept_name)) = LOWER(TRIM(?)) LIMIT 1', [department]);
      }
      if (!deptRow) throw new Error('A valid department is required.');
      if (role === 'teacher') {
        const [teacherResult] = await conn.query('INSERT INTO teachers (user_id, staff_no, dept_id, qualification, date_joined) VALUES (?, ?, ?, ?, CURDATE())',
          [userId, body.staff_no || null, deptRow.id, body.qualification || null]);
        const subjectNames = Array.isArray(body.subjects) ? body.subjects : (body.subject ? [body.subject] : []);
        for (const subject of subjectNames) {
          const [[subjectRow]] = await conn.query('SELECT id FROM subjects WHERE subject_name = ? LIMIT 1', [subject]);
          if (!subjectRow) throw new Error(`Subject not found: ${subject}`);
          await conn.query('INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)', [teacherResult.insertId, subjectRow.id]);
          const [[currentSession]] = await conn.query('SELECT id FROM academic_sessions WHERE is_current=1 ORDER BY start_date DESC LIMIT 1');
          if (currentSession) {
            // Provision assignments for every class/arm where the subject belongs to the curriculum.
            // Track is derived from stored data (class_levels.is_junior, arms.arm_type) rather
            // than hardcoded name lists — otherwise renaming or adding an arm silently breaks
            // assignment provisioning for every teacher created afterwards.
            const [levels] = await conn.query('SELECT id,level_name,is_junior FROM class_levels');
            const [arms] = await conn.query('SELECT id,arm_name,arm_type FROM arms');
            for (const level of levels) for (const arm of arms) {
              const track = level.is_junior ? 'junior' : arm.arm_type;
              if (!TRACKS.includes(track)) continue;
              const [[mapped]] = await conn.query('SELECT id FROM track_subjects WHERE track=? AND subject_id=? LIMIT 1',[track,subjectRow.id]);
              if (mapped) await conn.query(`INSERT IGNORE INTO teacher_class_assignments(teacher_id,subject_id,class_level_id,arm_id,session_id) VALUES(?,?,?,?,?)`,[teacherResult.insertId,subjectRow.id,level.id,arm.id,currentSession.id]);
            }
          }
        }
      } else {
        await conn.query('INSERT INTO hods (user_id, dept_id, appointed_date) VALUES (?, ?, CURDATE())', [userId, deptRow.id]);
      }
    }

    await conn.query('INSERT INTO activity_log (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'CREATE_USER', 'user', userId, JSON.stringify({ user_code, role })]);
    await conn.commit();
    res.status(201).json({ message: 'Account created successfully.', user: { id: userId, user_code, name: full_name, role } });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A unique user or role record already exists.' });
    if (['Student requires a valid class, arm and track.', 'Invalid class or arm.', 'A valid department is required.'].includes(err.message) || err.message.startsWith('Subject not found:')) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[admin/users]', err); res.status(500).json({ error: 'Unable to create account.' });
  } finally { conn.release(); }
});

router.get('/users', requireManagement, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const params = [];
  let searchClause = '';
  if (q) { searchClause = 'AND (full_name LIKE ? OR user_code LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  try {
    const [rows] = await db.query(`SELECT id AS user_id, user_code, full_name, email, role, is_active, last_login
      FROM users WHERE is_active=1 ${searchClause}
      ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'commandant' THEN 2 WHEN 'hod' THEN 3 WHEN 'teacher' THEN 4 WHEN 'student' THEN 5 ELSE 6 END, full_name
      LIMIT 300`, params);
    res.json({ rows, truncated: rows.length === 300 });
  } catch (err) { console.error('[admin/users]', err); res.status(500).json({ error: 'Unable to load accounts.' }); }
});

router.get('/teachers', requireStaffDirectory, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const params = [];
  // An HOD's menu item reads "Department Teachers" and that is what they should
  // get — previously this returned every teacher in the school to them, which is
  // both a privilege overreach and misleading. Admin/commandant still see all.
  let deptClause = '';
  if (req.user.role === 'hod') {
    const [[hod]] = await db.query('SELECT dept_id FROM hods WHERE user_id=? LIMIT 1', [req.user.id]);
    if (!hod) return res.status(404).json({ error: 'No department is assigned to your account. Contact an administrator.' });
    deptClause = 'AND t.dept_id = ?';
    params.push(hod.dept_id);
  }
  let searchClause = '';
  if (q) { searchClause = 'HAVING u.full_name LIKE ? OR u.user_code LIKE ? OR subjects LIKE ?'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  try {
    const [rows] = await db.query(`SELECT u.id AS user_id,u.user_code,u.full_name,u.email,u.gender,t.id AS teacher_id,t.staff_no,d.dept_name AS department,t.qualification,t.date_joined,
      GROUP_CONCAT(DISTINCT s.subject_name ORDER BY s.subject_name SEPARATOR ', ') AS subjects
      FROM teachers t JOIN users u ON u.id=t.user_id LEFT JOIN departments d ON d.id=t.dept_id
      LEFT JOIN teacher_subjects ts ON ts.teacher_id=t.id LEFT JOIN subjects s ON s.id=ts.subject_id
      WHERE u.is_active=1 ${deptClause} GROUP BY u.id,t.id,d.dept_name ${searchClause} ORDER BY u.full_name LIMIT 300`, params);
    res.json({ rows, truncated: rows.length === 300 });
  } catch (err) { console.error('[admin/teachers]', err); res.status(500).json({ error: 'Unable to load teachers.' }); }
});

router.get('/results', requireManagement, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const params = [];
  let searchClause = '';
  if (q) { searchClause = 'AND (su.full_name LIKE ? OR su.user_code LIKE ? OR sub.subject_name LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  try {
    const [rows] = await db.query(`SELECT r.id,su.user_code AS student_code,su.full_name AS student_name,sub.subject_name,t.term_name,ac.session_name,
      r.ca_score,r.exam_score,r.total_score,r.grade,r.remark,r.is_approved,r.uploaded_at,r.approved_at
      FROM results r JOIN students s ON s.id=r.student_id JOIN users su ON su.id=s.user_id JOIN subjects sub ON sub.id=r.subject_id
      JOIN terms t ON t.id=r.term_id JOIN academic_sessions ac ON ac.id=t.session_id
      WHERE 1=1 ${searchClause}
      ORDER BY r.updated_at DESC LIMIT 500`, params);
    res.json({ rows, truncated: rows.length === 500 });
  } catch (err) { console.error('[admin/results]', err); res.status(500).json({ error: 'Unable to load results.' }); }
});



router.delete('/users/:userId', requireManagement, async (req, res) => {
  const targetId = Number(req.params.userId);
  if (!Number.isInteger(targetId) || targetId < 1) return res.status(400).json({ error: 'Invalid account ID.' });
  if (targetId === req.user.id) return res.status(400).json({ error: 'You cannot remove your own account.' });
  try {
    const [[target]] = await db.query('SELECT id, user_code, full_name, role FROM users WHERE id=? LIMIT 1', [targetId]);
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (['admin','commandant'].includes(target.role) && req.user.role !== 'commandant') {
      return res.status(403).json({ error: 'Only the Commandant can remove management-level accounts.' });
    }

    // Preserve academic history and the audit trail. Account removal in the
    // management UI therefore means revoking portal access, not destroying
    // historical records.
    const [result] = await db.query('UPDATE users SET is_active=0 WHERE id=? AND is_active=1', [targetId]);
    if (!result.affectedRows) return res.status(409).json({ error: 'Account is already inactive.' });

    await db.query(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'DEACTIVATE_USER', 'user', targetId, JSON.stringify({ user_code: target.user_code, role: target.role })]
    );
    res.json({ message: 'Account access removed.', user: { id: target.id, user_code: target.user_code, name: target.full_name, role: target.role } });
  } catch (err) {
    console.error('[admin/remove-user]', err);
    res.status(500).json({ error: 'Unable to remove account access.' });
  }
});

router.patch('/users/:userId/status', requireManagement, async (req, res) => {
  const active = req.body?.is_active ? 1 : 0;
  const targetId = Number(req.params.userId);
  if (targetId === req.user.id) return res.status(400).json({ error: 'You cannot change your own account status.' });
  try {
    const [[target]] = await db.query('SELECT id,role FROM users WHERE id=? LIMIT 1', [targetId]);
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (['admin','commandant'].includes(target.role) && req.user.role !== 'commandant') return res.status(403).json({ error: 'Only the Commandant can change management-level account status.' });
    const [result] = await db.query('UPDATE users SET is_active=? WHERE id=?', [active, targetId]);
    if (!result.affectedRows) return res.status(409).json({ error: active ? 'Account is already active.' : 'Account is already inactive.' });
    res.json({ message: active ? 'Account activated.' : 'Account deactivated.' });
  } catch (err) { console.error('[admin/status]', err); res.status(500).json({ error: 'Unable to update account status.' }); }
});

// ---- ADMIN-DRIVEN PASSWORD RESET ----
// For a school on its own LAN there is no email/SMS to run a self-service
// "forgot password" flow through, so the supported recovery path is: an
// admin or commandant sets a new password directly and hands it to the
// person. Management-level targets (admin/commandant) can only be reset by
// the Commandant, mirroring the status-change rule above. Unlike status
// changes, resetting your own password through this route is allowed
// (useful if you're locked out on one device but still signed in on
// another) — self-service change with the current password is also
// available via PATCH /api/auth/password.
router.patch('/users/:userId/password', requireManagement, async (req, res) => {
  const targetId = Number(req.params.userId);
  const newPassword = String(req.body?.new_password || '');
  if (!Number.isInteger(targetId) || targetId < 1) return res.status(400).json({ error: 'Invalid user ID.' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
  try {
    const [[target]] = await db.query('SELECT id, role, user_code, full_name FROM users WHERE id=? LIMIT 1', [targetId]);
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (['admin','commandant'].includes(target.role) && req.user.role !== 'commandant') return res.status(403).json({ error: 'Only the Commandant can reset a management-level account password.' });
    const hash = await bcrypt.hash(newPassword, 12);
    await db.query('UPDATE users SET password_hash=? WHERE id=?', [hash, targetId]);
    await db.query('INSERT INTO activity_log (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'RESET_PASSWORD', 'user', targetId, JSON.stringify({ user_code: target.user_code })]);
    res.json({ message: `Password reset for ${target.full_name} (${target.user_code}).` });
  } catch (err) { console.error('[admin/password-reset]', err); res.status(500).json({ error: 'Unable to reset password.' }); }
});

// ---- STUDENT LIFECYCLE STATUS ----
// A student's enrollment status is distinct from users.is_active (which only
// gates login). Changing status here keeps both in sync: only 'active'
// students can log in; pending/withdrawn/graduated students are locked out
// of the portal but their account, admission record and academic history are
// never deleted.
const STUDENT_STATUSES = ['active', 'pending', 'withdrawn', 'graduated'];
router.patch('/students/:studentId/status', requireManagement, async (req, res) => {
  const studentId = Number(req.params.studentId);
  const status = String(req.body?.status || '').toLowerCase();
  const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 160) : null;
  if (!Number.isInteger(studentId) || studentId < 1) return res.status(400).json({ error: 'Invalid student ID.' });
  if (!STUDENT_STATUSES.includes(status)) return res.status(400).json({ error: `Status must be one of: ${STUDENT_STATUSES.join(', ')}.` });

  const conn = await db.getConnection();
  try {
    const [[row]] = await conn.query(`SELECT s.id, s.status AS current_status, u.id AS user_id, u.user_code, u.full_name
      FROM students s JOIN users u ON u.id = s.user_id WHERE s.id=? LIMIT 1`, [studentId]);
    if (!row) return res.status(404).json({ error: 'Student not found.' });
    if (row.current_status === status) return res.json({ message: `Student is already marked ${status}.` });

    await conn.beginTransaction();
    await conn.query('UPDATE students SET status=?, status_reason=?, status_updated_at=NOW() WHERE id=?', [status, reason, studentId]);
    // Only an 'active' student may log in. Every other lifecycle state locks the account
    // without touching admission records, results, or attendance history.
    await conn.query('UPDATE users SET is_active=? WHERE id=?', [status === 'active' ? 1 : 0, row.user_id]);
    await conn.query('INSERT INTO activity_log (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'STUDENT_STATUS_CHANGE', 'student', studentId, JSON.stringify({ user_code: row.user_code, from: row.current_status, to: status, reason })]);
    await conn.commit();
    res.json({ message: `${row.full_name} marked ${status}.`, student_id: studentId, status });
  } catch (err) {
    await conn.rollback();
    console.error('[admin/students/status]', err); res.status(500).json({ error: 'Unable to update student status.' });
  } finally { conn.release(); }
});

// ---- SUBJECT & CURRICULUM MANAGEMENT ----
// Subjects are never hard-deleted (results reference them permanently). "No
// longer offered" is expressed as is_active=0, which also removes the
// subject from the reference list new teacher assignments/account creation
// draw from (GET /meta already filters is_active=1).
router.get('/subjects', requireManagement, async (req, res) => {
  const deptId = Number(req.query.dept_id);
  const params = [];
  let deptClause = '';
  if (Number.isInteger(deptId) && deptId > 0) { deptClause = 'WHERE s.dept_id = ?'; params.push(deptId); }
  try {
    const [rows] = await db.query(`SELECT s.id, s.subject_name, s.dept_id, d.dept_name, s.ca_max, s.exam_max, s.is_active,
      GROUP_CONCAT(DISTINCT ts.track ORDER BY ts.track SEPARATOR ',') AS tracks
      FROM subjects s LEFT JOIN departments d ON d.id = s.dept_id LEFT JOIN track_subjects ts ON ts.subject_id = s.id
      ${deptClause} GROUP BY s.id ORDER BY s.subject_name`, params);
    res.json(rows.map(r => ({ ...r, tracks: r.tracks ? r.tracks.split(',') : [] })));
  } catch (err) { console.error('[admin/subjects]', err); res.status(500).json({ error: 'Unable to load subjects.' }); }
});

router.post('/subjects', requireManagement, async (req, res) => {
  const subject_name = String(req.body?.subject_name || '').trim();
  const dept_id = Number(req.body?.dept_id) || null;
  const ca_max = Number.isFinite(Number(req.body?.ca_max)) ? Number(req.body.ca_max) : 30;
  const exam_max = Number.isFinite(Number(req.body?.exam_max)) ? Number(req.body.exam_max) : 70;
  if (!subject_name || subject_name.length < 2) return res.status(400).json({ error: 'Subject name is required.' });
  if (ca_max < 0 || ca_max > 100 || exam_max < 0 || exam_max > 100) return res.status(400).json({ error: 'CA and exam maximums must be between 0 and 100.' });
  try {
    const [result] = await db.query('INSERT INTO subjects (subject_name, dept_id, ca_max, exam_max, is_active) VALUES (?, ?, ?, ?, 1)', [subject_name, dept_id, ca_max, exam_max]);
    await db.query('INSERT INTO activity_log (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'CREATE_SUBJECT', 'subject', result.insertId, JSON.stringify({ subject_name })]);
    res.status(201).json({ message: 'Subject created.', id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A subject with this name already exists.' });
    console.error('[admin/subjects/create]', err); res.status(500).json({ error: 'Unable to create subject.' });
  }
});

router.patch('/subjects/:subjectId', requireManagement, async (req, res) => {
  const subjectId = Number(req.params.subjectId);
  if (!Number.isInteger(subjectId) || subjectId < 1) return res.status(400).json({ error: 'Invalid subject ID.' });
  const fields = [];
  const params = [];
  if (req.body?.subject_name != null) { fields.push('subject_name=?'); params.push(String(req.body.subject_name).trim()); }
  if (req.body?.dept_id != null) { fields.push('dept_id=?'); params.push(Number(req.body.dept_id) || null); }
  if (req.body?.ca_max != null) { fields.push('ca_max=?'); params.push(Number(req.body.ca_max)); }
  if (req.body?.exam_max != null) { fields.push('exam_max=?'); params.push(Number(req.body.exam_max)); }
  if (!fields.length) return res.status(400).json({ error: 'No changes supplied.' });
  params.push(subjectId);
  try {
    const [result] = await db.query(`UPDATE subjects SET ${fields.join(', ')} WHERE id=?`, params);
    if (!result.affectedRows) return res.status(404).json({ error: 'Subject not found.' });
    res.json({ message: 'Subject updated.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A subject with this name already exists.' });
    console.error('[admin/subjects/update]', err); res.status(500).json({ error: 'Unable to update subject.' });
  }
});

router.patch('/subjects/:subjectId/status', requireManagement, async (req, res) => {
  const subjectId = Number(req.params.subjectId);
  const is_active = req.body?.is_active ? 1 : 0;
  if (!Number.isInteger(subjectId) || subjectId < 1) return res.status(400).json({ error: 'Invalid subject ID.' });
  try {
    const [[subject]] = await db.query('SELECT id, subject_name FROM subjects WHERE id=? LIMIT 1', [subjectId]);
    if (!subject) return res.status(404).json({ error: 'Subject not found.' });
    await db.query('UPDATE subjects SET is_active=? WHERE id=?', [is_active, subjectId]);
    await db.query('INSERT INTO activity_log (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, is_active ? 'REACTIVATE_SUBJECT' : 'DEACTIVATE_SUBJECT', 'subject', subjectId, JSON.stringify({ subject_name: subject.subject_name })]);
    res.json({ message: is_active ? 'Subject marked as offered.' : 'Subject marked as no longer offered.' });
  } catch (err) { console.error('[admin/subjects/status]', err); res.status(500).json({ error: 'Unable to update subject status.' }); }
});

router.post('/curriculum/toggle', requireManagement, async (req, res) => {
  const track = String(req.body?.track || '').toLowerCase();
  const subject_id = Number(req.body?.subject_id);
  const enabled = !!req.body?.enabled;
  if (!TRACKS.includes(track)) return res.status(400).json({ error: 'Invalid curriculum track.' });
  if (!Number.isInteger(subject_id) || subject_id < 1) return res.status(400).json({ error: 'Invalid subject ID.' });
  try {
    if (enabled) {
      await db.query('INSERT IGNORE INTO track_subjects (track, subject_id) VALUES (?, ?)', [track, subject_id]);
    } else {
      await db.query('DELETE FROM track_subjects WHERE track=? AND subject_id=?', [track, subject_id]);
    }
    await db.query('INSERT INTO activity_log (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, enabled ? 'ADD_CURRICULUM_SUBJECT' : 'REMOVE_CURRICULUM_SUBJECT', 'track_subjects', subject_id, JSON.stringify({ track })]);
    res.json({ message: enabled ? 'Subject added to curriculum track.' : 'Subject removed from curriculum track.' });
  } catch (err) { console.error('[admin/curriculum/toggle]', err); res.status(500).json({ error: 'Unable to update curriculum.' }); }
});

// ---- DEPARTMENT WORKSPACE ----
// Each department is isolated: an HOD (and the teachers in it) only ever see
// their own department's subjects, staff, students and results. Admin and the
// Commandant oversee every department and can pass ?dept_id= to inspect any of
// them. This is the single source of truth for "what belongs to a department",
// so scoping lives here rather than being re-derived in each panel.
async function resolveDepartmentScope(req) {
  if (['admin', 'commandant'].includes(req.user.role)) {
    const requested = Number(req.query.dept_id);
    return { deptId: Number.isInteger(requested) && requested > 0 ? requested : null, canSeeAll: true };
  }
  if (req.user.role === 'hod') {
    const [[hod]] = await db.query('SELECT dept_id FROM hods WHERE user_id=? LIMIT 1', [req.user.id]);
    if (!hod) return { error: 'No department is assigned to your account. Contact an administrator.' };
    return { deptId: hod.dept_id, canSeeAll: false };
  }
  if (req.user.role === 'teacher') {
    const [[t]] = await db.query('SELECT dept_id FROM teachers WHERE user_id=? LIMIT 1', [req.user.id]);
    if (!t) return { error: 'No department is assigned to your account. Contact an administrator.' };
    return { deptId: t.dept_id, canSeeAll: false };
  }
  return { error: 'Forbidden.' };
}

router.get('/departments', requireStaffReference, async (req, res) => {
  try {
    const scope = await resolveDepartmentScope(req);
    if (scope.error) return res.status(scope.error === 'Forbidden.' ? 403 : 404).json({ error: scope.error });
    let where = '', params = [];
    if (!scope.canSeeAll) { where = 'WHERE d.id = ?'; params = [scope.deptId]; }
    const [rows] = await db.query(`SELECT d.id, d.dept_name, d.description,
      (SELECT COUNT(*) FROM subjects s WHERE s.dept_id=d.id AND s.is_active=1) AS subject_count,
      (SELECT COUNT(*) FROM teachers t JOIN users u ON u.id=t.user_id WHERE t.dept_id=d.id AND u.is_active=1) AS teacher_count,
      (SELECT COUNT(*) FROM results r JOIN subjects s ON s.id=r.subject_id WHERE s.dept_id=d.id AND r.is_approved=0) AS pending_count,
      (SELECT CONCAT(u.full_name,'|',u.user_code) FROM hods h JOIN users u ON u.id=h.user_id WHERE h.dept_id=d.id AND u.is_active=1 LIMIT 1) AS hod_info
      FROM departments d ${where} ORDER BY d.dept_name`, params);
    res.json(rows.map(r => {
      const [hod_name, hod_code] = (r.hod_info || '|').split('|');
      const { hod_info, ...rest } = r;
      return { ...rest, hod_name: hod_name || null, hod_code: hod_code || null };
    }));
  } catch (err) { console.error('[admin/departments/list]', err); res.status(500).json({ error: 'Unable to load departments.' }); }
});

router.get('/departments/:deptId', requireStaffReference, async (req, res) => {
  const deptId = Number(req.params.deptId);
  if (!Number.isInteger(deptId) || deptId < 1) return res.status(400).json({ error: 'Invalid department ID.' });
  try {
    const scope = await resolveDepartmentScope(req);
    if (scope.error) return res.status(scope.error === 'Forbidden.' ? 403 : 404).json({ error: scope.error });
    if (!scope.canSeeAll && scope.deptId !== deptId) return res.status(403).json({ error: 'You can only view your own department.' });

    const [[dept]] = await db.query('SELECT id, dept_name, description FROM departments WHERE id=? LIMIT 1', [deptId]);
    if (!dept) return res.status(404).json({ error: 'Department not found.' });

    const [subjects, teachers, [[resultStats]], grades, classes] = await Promise.all([
      db.query(`SELECT s.id, s.subject_name, s.ca_max, s.exam_max, s.is_active,
        GROUP_CONCAT(DISTINCT ts.track ORDER BY ts.track SEPARATOR ',') AS tracks,
        (SELECT COUNT(*) FROM results r WHERE r.subject_id=s.id) AS result_count
        FROM subjects s LEFT JOIN track_subjects ts ON ts.subject_id=s.id
        WHERE s.dept_id=? GROUP BY s.id ORDER BY s.is_active DESC, s.subject_name`, [deptId]).then(r => r[0]),
      db.query(`SELECT u.id AS user_id, u.user_code, u.full_name, u.email, t.staff_no, t.qualification, t.date_joined,
        GROUP_CONCAT(DISTINCT sub.subject_name ORDER BY sub.subject_name SEPARATOR ', ') AS subjects
        FROM teachers t JOIN users u ON u.id=t.user_id
        LEFT JOIN teacher_subjects ts ON ts.teacher_id=t.id LEFT JOIN subjects sub ON sub.id=ts.subject_id
        WHERE t.dept_id=? AND u.is_active=1 GROUP BY u.id, t.id ORDER BY u.full_name`, [deptId]).then(r => r[0]),
      db.query(`SELECT COUNT(*) total, COUNT(CASE WHEN r.is_approved=1 THEN 1 END) approved,
        COUNT(CASE WHEN r.is_approved=0 THEN 1 END) pending, ROUND(AVG(CASE WHEN r.is_approved=1 THEN r.total_score END),1) avg_score
        FROM results r JOIN subjects s ON s.id=r.subject_id WHERE s.dept_id=?`, [deptId]),
      db.query(`SELECT r.grade, COUNT(*) AS n FROM results r JOIN subjects s ON s.id=r.subject_id
        WHERE s.dept_id=? AND r.is_approved=1 GROUP BY r.grade ORDER BY r.grade`, [deptId]).then(r => r[0]),
      db.query(`SELECT cl.level_name AS class_name, a.arm_name, COUNT(DISTINCT st.id) AS student_count,
        ROUND(AVG(CASE WHEN r.is_approved=1 THEN r.total_score END),1) AS avg_score
        FROM results r JOIN subjects s ON s.id=r.subject_id JOIN students st ON st.id=r.student_id
        JOIN class_levels cl ON cl.id=st.class_level_id JOIN arms a ON a.id=st.arm_id
        WHERE s.dept_id=? GROUP BY cl.id, a.id ORDER BY cl.sort_order, a.arm_name`, [deptId]).then(r => r[0])
    ]);

    res.json({
      department: dept,
      subjects: subjects.map(s => ({ ...s, tracks: s.tracks ? s.tracks.split(',') : [] })),
      teachers,
      stats: resultStats,
      grade_distribution: grades,
      classes
    });
  } catch (err) { console.error('[admin/departments/detail]', err); res.status(500).json({ error: 'Unable to load department.' }); }
});

router.post('/departments', requireManagement, async (req, res) => {
  const dept_name = String(req.body?.dept_name || '').trim();
  const description = req.body?.description ? String(req.body.description).trim() : null;
  if (!dept_name || dept_name.length < 2) return res.status(400).json({ error: 'Department name is required.' });
  try {
    const [result] = await db.query('INSERT INTO departments (dept_name, description) VALUES (?, ?)', [dept_name, description]);
    res.status(201).json({ message: 'Department created.', id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A department with this name already exists.' });
    console.error('[admin/departments]', err); res.status(500).json({ error: 'Unable to create department.' });
  }
});

// ---- ACADEMIC SESSIONS & TERMS ----
// A school needs to roll into a new session (e.g. 2027/2028) every year and
// open/lock terms as the calendar progresses, without a developer touching
// the database by hand. Exactly one session, and exactly one term, is ever
// "current" at a time — that's what teacher/student defaults and the
// dashboard read — so activating one always clears the others in the same
// transaction.
router.get('/sessions', requireManagement, async (req, res) => {
  try {
    const [sessions] = await db.query('SELECT id, session_name, is_current, start_date, end_date FROM academic_sessions ORDER BY start_date DESC, id DESC');
    const [terms] = await db.query('SELECT id, session_id, term_number, term_name, start_date, end_date, is_current, result_locked FROM terms ORDER BY session_id DESC, term_number');
    const bySession = {};
    for (const t of terms) { (bySession[t.session_id] = bySession[t.session_id] || []).push(t); }
    res.json(sessions.map(s => ({ ...s, terms: bySession[s.id] || [] })));
  } catch (err) { console.error('[admin/sessions]', err); res.status(500).json({ error: 'Unable to load academic sessions.' }); }
});

router.post('/sessions', requireManagement, async (req, res) => {
  const session_name = String(req.body?.session_name || '').trim();
  const start_date = req.body?.start_date || null;
  const end_date = req.body?.end_date || null;
  const make_current = !!req.body?.make_current;
  if (!/^\d{4}\/\d{4}$/.test(session_name)) return res.status(400).json({ error: 'Session name must look like 2027/2028.' });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query('INSERT INTO academic_sessions (session_name, start_date, end_date, is_current) VALUES (?, ?, ?, 0)', [session_name, start_date, end_date]);
    if (make_current) {
      await conn.query('UPDATE academic_sessions SET is_current=0');
      await conn.query('UPDATE academic_sessions SET is_current=1 WHERE id=?', [result.insertId]);
    }
    await conn.query('INSERT INTO activity_log (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'CREATE_SESSION', 'academic_session', result.insertId, JSON.stringify({ session_name })]);
    await conn.commit();
    res.status(201).json({ message: `${session_name} created.`, id: result.insertId });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A session with this name already exists.' });
    console.error('[admin/sessions/create]', err); res.status(500).json({ error: 'Unable to create session.' });
  } finally { conn.release(); }
});

router.patch('/sessions/:sessionId/activate', requireManagement, async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  const conn = await db.getConnection();
  try {
    const [[session]] = await conn.query('SELECT id, session_name FROM academic_sessions WHERE id=? LIMIT 1', [sessionId]);
    if (!session) return res.status(404).json({ error: 'Session not found.' });
    await conn.beginTransaction();
    await conn.query('UPDATE academic_sessions SET is_current=0');
    await conn.query('UPDATE academic_sessions SET is_current=1 WHERE id=?', [sessionId]);
    await conn.commit();
    res.json({ message: `${session.session_name} is now the current academic session.` });
  } catch (err) { await conn.rollback(); console.error('[admin/sessions/activate]', err); res.status(500).json({ error: 'Unable to activate session.' }); }
  finally { conn.release(); }
});

const TERM_NAMES = { 1: 'First Term', 2: 'Second Term', 3: 'Third Term' };
router.post('/sessions/:sessionId/terms', requireManagement, async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  const term_number = Number(req.body?.term_number);
  const start_date = req.body?.start_date || null;
  const end_date = req.body?.end_date || null;
  if (![1, 2, 3].includes(term_number)) return res.status(400).json({ error: 'Term number must be 1, 2, or 3.' });
  try {
    const [[session]] = await db.query('SELECT id FROM academic_sessions WHERE id=? LIMIT 1', [sessionId]);
    if (!session) return res.status(404).json({ error: 'Session not found.' });
    const term_name = TERM_NAMES[term_number];
    const [result] = await db.query('INSERT INTO terms (session_id, term_number, term_name, start_date, end_date) VALUES (?, ?, ?, ?, ?)', [sessionId, term_number, term_name, start_date, end_date]);
    res.status(201).json({ message: `${term_name} added.`, id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That term already exists for this session.' });
    console.error('[admin/terms/create]', err); res.status(500).json({ error: 'Unable to create term.' });
  }
});

router.patch('/terms/:termId', requireManagement, async (req, res) => {
  const termId = Number(req.params.termId);
  const conn = await db.getConnection();
  try {
    const [[term]] = await conn.query('SELECT id, term_name FROM terms WHERE id=? LIMIT 1', [termId]);
    if (!term) return res.status(404).json({ error: 'Term not found.' });
    await conn.beginTransaction();
    if (req.body?.is_current !== undefined) {
      if (req.body.is_current) {
        await conn.query('UPDATE terms SET is_current=0');
        await conn.query('UPDATE terms SET is_current=1 WHERE id=?', [termId]);
      } else {
        await conn.query('UPDATE terms SET is_current=0 WHERE id=?', [termId]);
      }
    }
    if (req.body?.result_locked !== undefined) {
      await conn.query('UPDATE terms SET result_locked=? WHERE id=?', [req.body.result_locked ? 1 : 0, termId]);
    }
    await conn.commit();
    res.json({ message: `${term.term_name} updated.` });
  } catch (err) { await conn.rollback(); console.error('[admin/terms/update]', err); res.status(500).json({ error: 'Unable to update term.' }); }
  finally { conn.release(); }
});

// ---- CLASS LEVELS & ARMS ----
// Schools reorganise: an arm gets renamed, a new one opens, an old one stops
// taking students. None of this should need a developer. Arms and classes are
// never hard-deleted while anyone references them — students and results point
// at them permanently — so "remove" means deactivate unless the row is genuinely
// unused, in which case a real delete is allowed.
const ARM_TYPES = ['science', 'technical', 'arts', 'junior'];

router.get('/classes', requireManagement, async (req, res) => {
  try {
    const [classes] = await db.query(`SELECT cl.id, cl.level_name, cl.is_junior, cl.sort_order,
      (SELECT COUNT(*) FROM students s WHERE s.class_level_id = cl.id) AS student_count
      FROM class_levels cl ORDER BY cl.sort_order, cl.id`);
    const [arms] = await db.query(`SELECT a.id, a.arm_name, a.arm_type, a.category, a.is_active,
      (SELECT COUNT(*) FROM students s WHERE s.arm_id = a.id) AS student_count
      FROM arms a ORDER BY a.is_active DESC, a.arm_name`);
    res.json({ classes, arms });
  } catch (err) { console.error('[admin/classes]', err); res.status(500).json({ error: 'Unable to load classes and arms.' }); }
});

router.post('/classes', requireManagement, async (req, res) => {
  const level_name = String(req.body?.level_name || '').trim();
  const is_junior = req.body?.is_junior ? 1 : 0;
  if (!level_name || level_name.length > 20) return res.status(400).json({ error: 'Class name is required (max 20 characters).' });
  try {
    const [[maxRow]] = await db.query('SELECT COALESCE(MAX(sort_order),0) AS m FROM class_levels');
    const [result] = await db.query('INSERT INTO class_levels (level_name, is_junior, sort_order) VALUES (?, ?, ?)', [level_name, is_junior, maxRow.m + 1]);
    await db.query('INSERT INTO activity_log (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'CREATE_CLASS_LEVEL', 'class_level', result.insertId, JSON.stringify({ level_name })]);
    res.status(201).json({ message: `${level_name} added.`, id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A class with this name already exists.' });
    console.error('[admin/classes/create]', err); res.status(500).json({ error: 'Unable to add class.' });
  }
});

router.patch('/classes/:classId', requireManagement, async (req, res) => {
  const classId = Number(req.params.classId);
  if (!Number.isInteger(classId) || classId < 1) return res.status(400).json({ error: 'Invalid class ID.' });
  const fields = [], params = [];
  if (req.body?.level_name != null) {
    const name = String(req.body.level_name).trim();
    if (!name || name.length > 20) return res.status(400).json({ error: 'Class name is required (max 20 characters).' });
    fields.push('level_name=?'); params.push(name);
  }
  if (req.body?.is_junior != null) { fields.push('is_junior=?'); params.push(req.body.is_junior ? 1 : 0); }
  if (req.body?.sort_order != null) { fields.push('sort_order=?'); params.push(Number(req.body.sort_order) || 0); }
  if (!fields.length) return res.status(400).json({ error: 'No changes supplied.' });
  params.push(classId);
  try {
    const [result] = await db.query(`UPDATE class_levels SET ${fields.join(', ')} WHERE id=?`, params);
    if (!result.affectedRows) return res.status(404).json({ error: 'Class not found.' });
    res.json({ message: 'Class updated.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A class with this name already exists.' });
    console.error('[admin/classes/update]', err); res.status(500).json({ error: 'Unable to update class.' });
  }
});

router.delete('/classes/:classId', requireManagement, async (req, res) => {
  const classId = Number(req.params.classId);
  if (!Number.isInteger(classId) || classId < 1) return res.status(400).json({ error: 'Invalid class ID.' });
  try {
    const [[cls]] = await db.query('SELECT id, level_name FROM class_levels WHERE id=? LIMIT 1', [classId]);
    if (!cls) return res.status(404).json({ error: 'Class not found.' });
    const [[inUse]] = await db.query('SELECT COUNT(*) AS n FROM students WHERE class_level_id=?', [classId]);
    if (inUse.n > 0) return res.status(409).json({ error: `${cls.level_name} still has ${inUse.n} student(s). Move or withdraw them before removing this class.` });
    await db.query('DELETE FROM teacher_class_assignments WHERE class_level_id=?', [classId]);
    await db.query('DELETE FROM class_levels WHERE id=?', [classId]);
    await db.query('INSERT INTO activity_log (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'DELETE_CLASS_LEVEL', 'class_level', classId, JSON.stringify({ level_name: cls.level_name })]);
    res.json({ message: `${cls.level_name} removed.` });
  } catch (err) { console.error('[admin/classes/delete]', err); res.status(500).json({ error: 'Unable to remove class.' }); }
});

router.post('/arms', requireManagement, async (req, res) => {
  const arm_name = String(req.body?.arm_name || '').trim();
  const arm_type = String(req.body?.arm_type || '').toLowerCase();
  const category = req.body?.category ? String(req.body.category).trim() : null;
  if (!arm_name || arm_name.length > 30) return res.status(400).json({ error: 'Arm name is required (max 30 characters).' });
  if (!ARM_TYPES.includes(arm_type)) return res.status(400).json({ error: `Arm type must be one of: ${ARM_TYPES.join(', ')}.` });
  try {
    const [result] = await db.query('INSERT INTO arms (arm_name, arm_type, category, is_active) VALUES (?, ?, ?, 1)', [arm_name, arm_type, category]);
    await db.query('INSERT INTO activity_log (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'CREATE_ARM', 'arm', result.insertId, JSON.stringify({ arm_name, arm_type })]);
    res.status(201).json({ message: `${arm_name} added.`, id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An arm with this name already exists.' });
    console.error('[admin/arms/create]', err); res.status(500).json({ error: 'Unable to add arm.' });
  }
});

router.patch('/arms/:armId', requireManagement, async (req, res) => {
  const armId = Number(req.params.armId);
  if (!Number.isInteger(armId) || armId < 1) return res.status(400).json({ error: 'Invalid arm ID.' });
  const fields = [], params = [];
  if (req.body?.arm_name != null) {
    const name = String(req.body.arm_name).trim();
    if (!name || name.length > 30) return res.status(400).json({ error: 'Arm name is required (max 30 characters).' });
    fields.push('arm_name=?'); params.push(name);
  }
  if (req.body?.arm_type != null) {
    const type = String(req.body.arm_type).toLowerCase();
    if (!ARM_TYPES.includes(type)) return res.status(400).json({ error: `Arm type must be one of: ${ARM_TYPES.join(', ')}.` });
    fields.push('arm_type=?'); params.push(type);
  }
  if (req.body?.category !== undefined) { fields.push('category=?'); params.push(req.body.category ? String(req.body.category).trim() : null); }
  if (req.body?.is_active != null) { fields.push('is_active=?'); params.push(req.body.is_active ? 1 : 0); }
  if (!fields.length) return res.status(400).json({ error: 'No changes supplied.' });
  params.push(armId);
  try {
    const [result] = await db.query(`UPDATE arms SET ${fields.join(', ')} WHERE id=?`, params);
    if (!result.affectedRows) return res.status(404).json({ error: 'Arm not found.' });
    res.json({ message: 'Arm updated.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An arm with this name already exists.' });
    console.error('[admin/arms/update]', err); res.status(500).json({ error: 'Unable to update arm.' });
  }
});

router.delete('/arms/:armId', requireManagement, async (req, res) => {
  const armId = Number(req.params.armId);
  if (!Number.isInteger(armId) || armId < 1) return res.status(400).json({ error: 'Invalid arm ID.' });
  try {
    const [[arm]] = await db.query('SELECT id, arm_name FROM arms WHERE id=? LIMIT 1', [armId]);
    if (!arm) return res.status(404).json({ error: 'Arm not found.' });
    const [[inUse]] = await db.query('SELECT COUNT(*) AS n FROM students WHERE arm_id=?', [armId]);
    if (inUse.n > 0) return res.status(409).json({ error: `${arm.arm_name} still has ${inUse.n} student(s). Deactivate it instead, or move them to another arm first.` });
    await db.query('DELETE FROM teacher_class_assignments WHERE arm_id=?', [armId]);
    await db.query('DELETE FROM arms WHERE id=?', [armId]);
    await db.query('INSERT INTO activity_log (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'DELETE_ARM', 'arm', armId, JSON.stringify({ arm_name: arm.arm_name })]);
    res.json({ message: `${arm.arm_name} removed.` });
  } catch (err) { console.error('[admin/arms/delete]', err); res.status(500).json({ error: 'Unable to remove arm.' }); }
});

module.exports = router;
