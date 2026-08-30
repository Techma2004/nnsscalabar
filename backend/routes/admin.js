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
      db.query('SELECT id, level_name FROM class_levels ORDER BY id'),
      db.query('SELECT id, arm_name, category FROM arms ORDER BY arm_name'),
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
            const [levels] = await conn.query('SELECT id,level_name FROM class_levels');
            const [arms] = await conn.query('SELECT id,arm_name FROM arms');
            const junior = new Set(['JSS1','JSS2','JSS3']);
            const science = new Set(['AGU','AYAM','DAMISA']);
            const technical = new Set(['EKUN','EKPE']);
            for (const level of levels) for (const arm of arms) {
              const track = junior.has(level.level_name) ? 'junior' : science.has(arm.arm_name) ? 'science' : technical.has(arm.arm_name) ? 'technical' : 'arts';
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
  try {
    const [rows] = await db.query(`SELECT id AS user_id, user_code, full_name, email, role, is_active, last_login
      FROM users WHERE is_active=1 ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'commandant' THEN 2 WHEN 'hod' THEN 3 WHEN 'teacher' THEN 4 WHEN 'student' THEN 5 ELSE 6 END, full_name`);
    res.json(rows);
  } catch (err) { console.error('[admin/users]', err); res.status(500).json({ error: 'Unable to load accounts.' }); }
});

router.get('/teachers', requireStaffDirectory, async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT u.id AS user_id,u.user_code,u.full_name,u.email,u.gender,t.id AS teacher_id,t.staff_no,d.dept_name AS department,t.qualification,t.date_joined,
      GROUP_CONCAT(DISTINCT s.subject_name ORDER BY s.subject_name SEPARATOR ', ') AS subjects
      FROM teachers t JOIN users u ON u.id=t.user_id LEFT JOIN departments d ON d.id=t.dept_id
      LEFT JOIN teacher_subjects ts ON ts.teacher_id=t.id LEFT JOIN subjects s ON s.id=ts.subject_id
      WHERE u.is_active=1 GROUP BY u.id,t.id,d.dept_name ORDER BY u.full_name`);
    res.json(rows);
  } catch (err) { console.error('[admin/teachers]', err); res.status(500).json({ error: 'Unable to load teachers.' }); }
});

router.get('/results', requireManagement, async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT r.id,su.user_code AS student_code,su.full_name AS student_name,sub.subject_name,t.term_name,ac.session_name,
      r.ca_score,r.exam_score,r.total_score,r.grade,r.remark,r.is_approved,r.uploaded_at,r.approved_at
      FROM results r JOIN students s ON s.id=r.student_id JOIN users su ON su.id=s.user_id JOIN subjects sub ON sub.id=r.subject_id
      JOIN terms t ON t.id=r.term_id JOIN academic_sessions ac ON ac.id=t.session_id
      ORDER BY r.updated_at DESC LIMIT 500`);
    res.json(rows);
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
  try {
    const [rows] = await db.query(`SELECT s.id, s.subject_name, s.dept_id, d.dept_name, s.ca_max, s.exam_max, s.is_active,
      GROUP_CONCAT(DISTINCT ts.track ORDER BY ts.track SEPARATOR ',') AS tracks
      FROM subjects s LEFT JOIN departments d ON d.id = s.dept_id LEFT JOIN track_subjects ts ON ts.subject_id = s.id
      GROUP BY s.id ORDER BY s.subject_name`);
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

module.exports = router;
