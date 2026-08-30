const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const router = express.Router();
router.use(auth);

router.get('/', async (req, res) => {
  if (!['admin','commandant','teacher','hod'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden.' });
  // Non-management staff (teacher/hod) only ever need the active roster for
  // day-to-day teaching; only admin/commandant can browse other lifecycle
  // states (pending, withdrawn, graduated) via ?status=.
  const canBrowseAllStatuses = ['admin', 'commandant'].includes(req.user.role);
  const requested = String(req.query.status || 'active').toLowerCase();
  const validStatuses = ['active', 'pending', 'withdrawn', 'graduated'];
  let statusClause = "AND s.status = 'active' AND u.is_active = 1";
  let params = [];
  if (canBrowseAllStatuses) {
    if (requested === 'all') { statusClause = ''; params = []; }
    else if (requested === 'active') { statusClause = "AND s.status = 'active' AND u.is_active = 1"; params = []; }
    else if (validStatuses.includes(requested)) { statusClause = 'AND s.status = ?'; params = [requested]; }
  }
  try {
    const [rows] = await db.query(`SELECT u.id AS user_id,u.user_code,u.full_name,u.gender,u.email,u.is_active,s.id AS student_id,s.admission_no,s.date_of_birth,s.parent_name,s.parent_phone,s.is_boarder,
      cl.level_name AS class,a.arm_name AS arm,s.track,s.status,s.status_reason,s.status_updated_at
      FROM students s JOIN users u ON u.id=s.user_id JOIN class_levels cl ON cl.id=s.class_level_id JOIN arms a ON a.id=s.arm_id
      WHERE 1=1 ${statusClause} ORDER BY cl.id,a.arm_name,u.full_name`, params);
    res.json(rows);
  } catch (err) { console.error('[students]', err); res.status(500).json({ error: 'Unable to load students.' }); }
});

router.get('/teacher/:teacherCode', async (req, res) => {
  if (!['teacher','hod','admin','commandant'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden.' });
  const teacherCode = String(req.params.teacherCode || '').trim().toUpperCase();
  if (req.user.role === 'teacher' && req.user.user_code !== teacherCode) return res.status(403).json({ error: 'You can only view your assigned students.' });
  try {
    const [rows] = await db.query(`SELECT DISTINCT u.user_code,u.full_name,s.id AS student_id,cl.level_name AS class,a.arm_name AS arm,s.track,s.admission_no
      FROM teacher_class_assignments tca JOIN teachers t ON t.id=tca.teacher_id JOIN users tu ON tu.id=t.user_id
      JOIN students s ON s.class_level_id=tca.class_level_id AND s.arm_id=tca.arm_id JOIN users u ON u.id=s.user_id JOIN class_levels cl ON cl.id=s.class_level_id JOIN arms a ON a.id=s.arm_id
      JOIN academic_sessions ac ON ac.id=tca.session_id WHERE tu.user_code=? AND u.is_active=1 AND ac.is_current=1 ORDER BY cl.id,a.arm_name,u.full_name`, [teacherCode]);
    res.json(rows);
  } catch (err) { console.error('[students/teacher]', err); res.status(500).json({ error: 'Unable to load assigned students.' }); }
});

router.get('/:studentCode', async (req, res) => {
  const code = String(req.params.studentCode || '').trim().toUpperCase();
  if (req.user.role === 'student' && req.user.user_code !== code) return res.status(403).json({ error: 'Forbidden.' });
  try {
    const [[student]] = await db.query(`SELECT u.id AS user_id,u.user_code,u.full_name,u.gender,u.email,s.id AS student_id,s.admission_no,s.date_of_birth,s.parent_name,s.parent_phone,s.is_boarder,
      cl.level_name AS class,a.arm_name AS arm,s.track FROM students s JOIN users u ON u.id=s.user_id JOIN class_levels cl ON cl.id=s.class_level_id JOIN arms a ON a.id=s.arm_id WHERE u.user_code=? AND u.is_active=1 LIMIT 1`, [code]);
    if (!student) return res.status(404).json({ error: 'Student not found.' });
    const canSeeAll = ['teacher','hod','admin','commandant'].includes(req.user.role);
    const [results] = await db.query(`SELECT r.id,sub.subject_name,t.term_name,ac.session_name,r.ca_score,r.exam_score,r.total_score,r.grade,r.remark,r.is_approved FROM results r JOIN subjects sub ON sub.id=r.subject_id JOIN terms t ON t.id=r.term_id JOIN academic_sessions ac ON ac.id=t.session_id WHERE r.student_id=? AND (r.is_approved=1 OR ?) ORDER BY ac.start_date DESC,t.term_number DESC,sub.subject_name`, [student.student_id, canSeeAll ? 1 : 0]);
    res.json({ student, results });
  } catch (err) { console.error('[students/detail]', err); res.status(500).json({ error: 'Unable to load student profile.' }); }
});

router.get('/:studentCode/subjects', async (req, res) => {
  const code = String(req.params.studentCode || '').trim().toUpperCase();
  if (req.user.role === 'student' && req.user.user_code !== code) return res.status(403).json({ error: 'Forbidden.' });
  try {
    const [rows] = await db.query(`SELECT sub.id,sub.subject_name,sub.ca_max,sub.exam_max FROM student_subject_enrollment e JOIN students s ON s.id=e.student_id JOIN users u ON u.id=s.user_id JOIN subjects sub ON sub.id=e.subject_id WHERE u.user_code=? AND e.is_active=1 ORDER BY sub.subject_name`, [code]);
    res.json(rows);
  } catch (err) { console.error('[students/subjects]', err); res.status(500).json({ error: 'Unable to load subjects.' }); }
});

module.exports = router;
