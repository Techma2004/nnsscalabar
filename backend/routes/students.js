const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const auth = require('../middleware/auth');
const router = express.Router();
// Apply a route-specific ceiling in addition to the API-wide limiter.
router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many student requests. Please try again later.' }
}));
router.use(auth);

// Student profile data is sensitive (date of birth, parent contact details and
// academic history). Enforce access on the server, not just in the UI.
async function canAccessStudent(user, student) {
  if (user.role === 'student') return user.user_code === student.user_code;
  if (['admin', 'commandant'].includes(user.role)) return true;
  if (user.role === 'teacher') {
    const [[assignment]] = await db.query(`SELECT 1 FROM teacher_class_assignments tca
      JOIN teachers t ON t.id=tca.teacher_id
      JOIN academic_sessions ac ON ac.id=tca.session_id
      WHERE t.user_id=? AND tca.class_level_id=? AND tca.arm_id=? AND ac.is_current=1 LIMIT 1`,
      [user.id, student.class_level_id, student.arm_id]);
    return Boolean(assignment);
  }
  if (user.role === 'hod') {
    const [[enrollment]] = await db.query(`SELECT 1 FROM student_subject_enrollment e
      JOIN subjects sub ON sub.id=e.subject_id
      JOIN academic_sessions ac ON ac.id=e.session_id
      JOIN hods h ON h.dept_id=sub.dept_id
      WHERE e.student_id=? AND e.is_active=1 AND ac.is_current=1 AND h.user_id=? LIMIT 1`,
      [student.student_id, user.id]);
    return Boolean(enrollment);
  }
  return false;
}

router.get('/', async (req, res) => {
  // This endpoint returns the roster across ALL classes — it must stay
  // restricted to admin/commandant. Teachers only ever see their own
  // assigned classes via GET /students/teacher/:teacherCode below; a teacher
  // hitting this route previously got the entire school's roster regardless
  // of what they actually teach, which was a real privilege overreach.
  if (!['admin','commandant'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden.' });
  const requested = String(req.query.status || 'active').toLowerCase();
  const validStatuses = ['active', 'pending', 'withdrawn', 'graduated', 'repeating'];
  const q = String(req.query.q || '').trim();
  let statusClause = "AND s.status = 'active' AND u.is_active = 1";
  let params = [];
  if (requested === 'all') { statusClause = ''; params = []; }
  else if (requested === 'active') { statusClause = "AND s.status = 'active' AND u.is_active = 1"; params = []; }
  else if (validStatuses.includes(requested)) { statusClause = 'AND s.status = ?'; params = [requested]; }
  let searchClause = '';
  if (q) { searchClause = 'AND (u.full_name LIKE ? OR u.user_code LIKE ? OR s.admission_no LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  try {
    const [rows] = await db.query(`SELECT u.id AS user_id,u.user_code,u.full_name,u.gender,u.email,u.is_active,s.id AS student_id,s.admission_no,s.date_of_birth,s.parent_name,s.parent_phone,
      cl.level_name AS class,a.arm_name AS arm,s.track,s.status,s.status_reason,s.status_updated_at
      FROM students s JOIN users u ON u.id=s.user_id JOIN class_levels cl ON cl.id=s.class_level_id JOIN arms a ON a.id=s.arm_id
      WHERE 1=1 ${statusClause} ${searchClause} ORDER BY cl.id,a.arm_name,u.full_name LIMIT 500`, params);
    res.json({ rows, truncated: rows.length === 500 });
  } catch (err) { console.error('[students]', err); res.status(500).json({ error: 'Unable to load students.' }); }
});

router.get('/teacher/:teacherCode', async (req, res) => {
  if (!['teacher','hod','admin','commandant'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden.' });
  const teacherCode = String(req.params.teacherCode || '').trim().toUpperCase();
  if (req.user.role === 'teacher' && req.user.user_code !== teacherCode) return res.status(403).json({ error: 'You can only view your assigned students.' });
  const q = String(req.query.q || '').trim();
  const params = [teacherCode];
  let searchClause = '';
  if (q) { searchClause = 'AND (u.full_name LIKE ? OR u.user_code LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  let departmentClause = '';
  if (req.user.role === 'hod') {
    departmentClause = 'AND EXISTS (SELECT 1 FROM hods h JOIN subjects sub ON sub.dept_id=h.dept_id WHERE h.user_id=? AND sub.id=tca.subject_id)';
    params.push(req.user.id);
  }
  try {
    const [rows] = await db.query(`SELECT DISTINCT u.user_code,u.full_name,s.id AS student_id,cl.level_name AS class,a.arm_name AS arm,s.track,s.admission_no
      FROM teacher_class_assignments tca JOIN teachers t ON t.id=tca.teacher_id JOIN users tu ON tu.id=t.user_id
      JOIN subjects sub ON sub.id=tca.subject_id
      JOIN students s ON s.class_level_id=tca.class_level_id AND s.arm_id=tca.arm_id JOIN users u ON u.id=s.user_id JOIN class_levels cl ON cl.id=s.class_level_id JOIN arms a ON a.id=s.arm_id
      JOIN academic_sessions ac ON ac.id=tca.session_id WHERE tu.user_code=? AND u.is_active=1 AND ac.is_current=1 ${searchClause} ${departmentClause} ORDER BY cl.id,a.arm_name,u.full_name`, params);
    res.json(rows);
  } catch (err) { console.error('[students/teacher]', err); res.status(500).json({ error: 'Unable to load assigned students.' }); }
});

router.get('/:studentCode', async (req, res) => {
  let code = String(req.params.studentCode || '').trim().toUpperCase();
  // Validate: 3-20 chars, letters/numbers/_- only (matching user_code convention)
  if (!/^[A-Z0-9_-]{3,20}$/.test(code)) return res.status(400).json({ error: 'Invalid student code format. Must be 3-20 characters using letters, numbers, _ or -.' });
  if (req.user.role === 'student' && req.user.user_code !== code) return res.status(403).json({ error: 'Forbidden.' });
  try {
    const [[student]] = await db.query(`SELECT u.id AS user_id,u.user_code,u.full_name,u.gender,u.email,s.id AS student_id,s.class_level_id,s.arm_id,s.admission_no,s.date_of_birth,s.parent_name,s.parent_phone,
      cl.level_name AS class,a.arm_name AS arm,s.track FROM students s JOIN users u ON u.id=s.user_id JOIN class_levels cl ON cl.id=s.class_level_id JOIN arms a ON a.id=s.arm_id WHERE u.user_code=? AND u.is_active=1 LIMIT 1`, [code]);
    if (!student) return res.status(404).json({ error: 'Student not found.' });
    if (!await canAccessStudent(req.user, student)) return res.status(403).json({ error: 'You are not assigned to this student.' });
    const canSeePending = ['admin', 'commandant', 'teacher', 'hod'].includes(req.user.role);
    let resultScope = '';
    const resultParams = [student.student_id, canSeePending ? 1 : 0];
    if (req.user.role === 'teacher') {
      resultScope = `AND EXISTS (SELECT 1 FROM teacher_class_assignments tca JOIN teachers tch ON tch.id=tca.teacher_id
        JOIN academic_sessions assigned_session ON assigned_session.id=tca.session_id
        WHERE tch.user_id=? AND tca.subject_id=r.subject_id AND tca.class_level_id=student_row.class_level_id
          AND tca.arm_id=student_row.arm_id AND tca.session_id=ac.id AND assigned_session.is_current=1)`;
      resultParams.push(req.user.id);
    } else if (req.user.role === 'hod') {
      resultScope = 'AND sub.dept_id=(SELECT dept_id FROM hods WHERE user_id=?)';
      resultParams.push(req.user.id);
    }
    const [results] = await db.query(`SELECT r.id,sub.subject_name,t.term_name,ac.session_name,r.ca_score,r.exam_score,r.total_score,r.grade,r.remark,r.is_approved
      FROM results r JOIN students student_row ON student_row.id=r.student_id JOIN subjects sub ON sub.id=r.subject_id JOIN terms t ON t.id=r.term_id JOIN academic_sessions ac ON ac.id=t.session_id
      WHERE r.student_id=? AND (r.is_approved=1 OR ?) ${resultScope} ORDER BY ac.start_date DESC,t.term_number DESC,sub.subject_name`, resultParams);
    res.json({ student, results });
  } catch (err) { console.error('[students/detail]', err); res.status(500).json({ error: 'Unable to load student profile.' }); }
});

router.get('/:studentCode/subjects', async (req, res) => {
  const code = String(req.params.studentCode || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,20}$/.test(code)) return res.status(400).json({ error: 'Invalid student code format.' });
  try {
    const [[student]] = await db.query(`SELECT s.id AS student_id,s.class_level_id,s.arm_id,u.user_code FROM students s
      JOIN users u ON u.id=s.user_id WHERE u.user_code=? AND u.is_active=1 LIMIT 1`, [code]);
    if (!student) return res.status(404).json({ error: 'Student not found.' });
    if (!await canAccessStudent(req.user, student)) return res.status(403).json({ error: 'You are not assigned to this student.' });
    let subjectScope = '';
    const params = [student.student_id];
    if (req.user.role === 'teacher') {
      subjectScope = `AND EXISTS (SELECT 1 FROM teacher_class_assignments tca JOIN teachers tch ON tch.id=tca.teacher_id
        JOIN academic_sessions ac ON ac.id=tca.session_id WHERE tch.user_id=? AND tca.subject_id=sub.id
          AND tca.class_level_id=? AND tca.arm_id=? AND tca.session_id=e.session_id AND ac.is_current=1)`;
      params.push(req.user.id, student.class_level_id, student.arm_id);
    } else if (req.user.role === 'hod') {
      subjectScope = 'AND sub.dept_id=(SELECT dept_id FROM hods WHERE user_id=?)';
      params.push(req.user.id);
    }
    const [rows] = await db.query(`SELECT DISTINCT sub.id,sub.subject_name,sub.ca_max,sub.exam_max
      FROM student_subject_enrollment e JOIN subjects sub ON sub.id=e.subject_id
      WHERE e.student_id=? AND e.is_active=1 ${subjectScope} ORDER BY sub.subject_name`, params);
    res.json(rows);
  } catch (err) { console.error('[students/subjects]', err); res.status(500).json({ error: 'Unable to load subjects.' }); }
});

module.exports = router;
