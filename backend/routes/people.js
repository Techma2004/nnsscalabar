'use strict';
/*
 * People directory and profiles.
 *
 *   GET /api/people/directory?kind=teachers|students&q=   searchable list
 *   GET /api/people/:userId                               one person's profile + activity
 *
 * Admin and Commandant can open anyone. An HOD can open the teachers of their own
 * department and the students enrolled in that department's subjects this session.
 * Everything shown is read from the database: nothing is estimated or filled in,
 * and a figure that does not exist is simply left out.
 */
const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const v = require('../validate');
const { routeLimiter } = require('../middleware/security');
const router = express.Router();
router.use(routeLimiter(300, 'Too many directory requests. Please try again later.'));
router.use(auth);

const MANAGEMENT = ['admin', 'commandant'];
const LIMIT = 300;

async function hodDept(userId) {
  const [[hod]] = await db.query('SELECT dept_id FROM hods WHERE user_id=? LIMIT 1', [userId]);
  return hod?.dept_id || null;
}
async function deptName(deptId) {
  if (!deptId) return null;
  const [[d]] = await db.query('SELECT dept_name FROM departments WHERE id=? LIMIT 1', [deptId]);
  return d?.dept_name || null;
}
async function currentSessionId() {
  const [[row]] = await db.query('SELECT id FROM academic_sessions WHERE is_current=1 ORDER BY start_date DESC LIMIT 1');
  return row?.id || null;
}
const deptStudentSql = `EXISTS (SELECT 1 FROM student_subject_enrollment e JOIN subjects sub ON sub.id=e.subject_id
  WHERE e.student_id=s.id AND e.is_active=1 AND e.session_id=? AND sub.dept_id=?)`;

router.get('/directory', async (req, res) => {
  const role = req.user.role;
  if (![...MANAGEMENT, 'hod'].includes(role)) return res.status(403).json({ error: 'Directory access is limited to management and heads of department.' });
  const kind = req.query.kind === 'students' ? 'students' : 'teachers';
  const q = String(req.query.q || '').trim().slice(0, 80);
  const like = `%${q}%`;
  try {
    let deptId = null, sessionId = null;
    if (role === 'hod') {
      deptId = await hodDept(req.user.id);
      if (!deptId) return res.status(404).json({ error: 'No department is assigned to your account. Contact an administrator.' });
      sessionId = await currentSessionId();
    }
    if (kind === 'teachers') {
      const params = [];
      let where = 'u.is_active=1';
      if (deptId) { where += ' AND t.dept_id=?'; params.push(deptId); }
      if (q) { where += ` AND (u.full_name LIKE ? OR u.user_code LIKE ? OR EXISTS (SELECT 1 FROM teacher_subjects x JOIN subjects xs ON xs.id=x.subject_id WHERE x.teacher_id=t.id AND xs.subject_name LIKE ?))`; params.push(like, like, like); }
      const [rows] = await db.query(`SELECT u.id AS user_id, u.user_code, u.full_name, u.email, u.phone, t.id AS teacher_id, d.dept_name AS department,
          (SELECT GROUP_CONCAT(xs.subject_name ORDER BY xs.subject_name SEPARATOR ', ') FROM teacher_subjects x JOIN subjects xs ON xs.id=x.subject_id WHERE x.teacher_id=t.id) AS subjects
        FROM teachers t JOIN users u ON u.id=t.user_id LEFT JOIN departments d ON d.id=t.dept_id
        WHERE ${where} ORDER BY u.full_name LIMIT ${LIMIT}`, params);
      return res.json({ rows, truncated: rows.length === LIMIT, scope: await deptName(deptId) });
    }
    const status = ['active', 'repeating', 'pending', 'withdrawn', 'graduated', 'all'].includes(req.query.status) ? req.query.status : 'active';
    const params = [];
    let where = '1=1';
    if (deptId) { where += ` AND ${deptStudentSql}`; params.push(sessionId || 0, deptId); }
    if (status === 'active') where += " AND s.status IN ('active','repeating') AND u.is_active=1";
    else if (status !== 'all') { where += ' AND s.status=?'; params.push(status); }
    if (q) { where += ' AND (u.full_name LIKE ? OR u.user_code LIKE ? OR s.admission_no LIKE ?)'; params.push(like, like, like); }
    const [rows] = await db.query(`SELECT u.id AS user_id, u.user_code, u.full_name, s.admission_no, s.parent_name, s.parent_phone, s.status,
        cl.level_name AS class, a.arm_name AS arm, s.track
      FROM students s JOIN users u ON u.id=s.user_id JOIN class_levels cl ON cl.id=s.class_level_id JOIN arms a ON a.id=s.arm_id
      WHERE ${where} ORDER BY cl.sort_order, cl.id, a.arm_name, u.full_name LIMIT ${LIMIT}`, params);
    res.json({ rows, truncated: rows.length === LIMIT, scope: await deptName(deptId) });
  } catch (err) { console.error('[people/directory]', err); res.status(500).json({ error: 'Unable to load the directory.' }); }
});

router.get('/:userId', async (req, res) => {
  const role = req.user.role;
  if (![...MANAGEMENT, 'hod'].includes(role)) return res.status(403).json({ error: 'Profile access is limited to management and heads of department.' });
  const userId = v.id(req.params.userId);
  if (!userId) return res.status(400).json({ error: 'Invalid user.' });
  try {
    const [[user]] = await db.query(`SELECT id, user_code, full_name, email, phone, role, gender, is_active, last_login, created_at FROM users WHERE id=? LIMIT 1`, [userId]);
    if (!user) return res.status(404).json({ error: 'Person not found.' });

    let deptId = null, sessionId = await currentSessionId();
    if (role === 'hod') {
      deptId = await hodDept(req.user.id);
      if (!deptId) return res.status(404).json({ error: 'No department is assigned to your account.' });
      if (user.role === 'teacher') {
        const [[ok]] = await db.query('SELECT 1 AS ok FROM teachers WHERE user_id=? AND dept_id=? LIMIT 1', [userId, deptId]);
        if (!ok) return res.status(403).json({ error: 'That teacher is outside your department.' });
      } else if (user.role === 'student') {
        const [[ok]] = await db.query(`SELECT 1 AS ok FROM students s WHERE s.user_id=? AND ${deptStudentSql} LIMIT 1`, [userId, sessionId || 0, deptId]);
        if (!ok) return res.status(403).json({ error: 'That student is not enrolled in any subject of your department.' });
      } else return res.status(403).json({ error: 'Heads of department can open teachers and students of their own department.' });
    }

    const out = { user: { ...user, last_login: user.last_login, created_at: user.created_at }, can_edit_contact: MANAGEMENT.includes(role) && (user.role !== 'admin' && user.role !== 'commandant' || role === 'commandant' || user.id === req.user.id) };

    if (user.role === 'student') {
      const [[st]] = await db.query(`SELECT s.id AS student_id, s.admission_no, s.parent_name, s.parent_phone, s.status, s.status_reason, s.is_boarder, s.date_of_birth, s.track,
          cl.level_name AS class, a.arm_name AS arm FROM students s JOIN class_levels cl ON cl.id=s.class_level_id JOIN arms a ON a.id=s.arm_id WHERE s.user_id=? LIMIT 1`, [userId]);
      out.student = st || null;
      if (st) {
        const [subjects] = await db.query(`SELECT sub.subject_name, d.dept_name FROM student_subject_enrollment e JOIN subjects sub ON sub.id=e.subject_id
          LEFT JOIN departments d ON d.id=sub.dept_id WHERE e.student_id=? AND e.is_active=1 AND e.session_id=? ${deptId ? 'AND sub.dept_id=?' : ''} ORDER BY sub.subject_name`,
          deptId ? [st.student_id, sessionId || 0, deptId] : [st.student_id, sessionId || 0]);
        out.subjects = subjects;
        // Management sees every result; an HOD only their own department's. Averages use approved results only.
        const [terms] = await db.query(`SELECT t.id AS term_id, t.term_name, ac.session_name, COUNT(*) AS subjects,
            SUM(r.is_approved=1) AS approved, SUM(r.is_approved=0) AS awaiting,
            ROUND(AVG(CASE WHEN r.is_approved=1 THEN r.total_score END),1) AS average
          FROM results r JOIN terms t ON t.id=r.term_id JOIN academic_sessions ac ON ac.id=t.session_id JOIN subjects sub ON sub.id=r.subject_id
          WHERE r.student_id=? ${deptId ? 'AND sub.dept_id=?' : ''} GROUP BY t.id, ac.id ORDER BY ac.start_date DESC, t.term_number DESC`,
          deptId ? [st.student_id, deptId] : [st.student_id]);
        out.terms = terms.map(x => ({ ...x, subjects: Number(x.subjects), approved: Number(x.approved), awaiting: Number(x.awaiting), average: x.average === null ? null : Number(x.average) }));
        const [requests] = await db.query(`SELECT cr.id, cr.request_type, cr.status, cr.reason, cr.review_note, cr.created_at, cr.reviewed_at, ta.arm_name AS target_arm, sub.subject_name
          FROM change_requests cr LEFT JOIN arms ta ON ta.id=cr.target_arm_id LEFT JOIN subjects sub ON sub.id=cr.subject_id
          WHERE cr.student_id=? ${deptId ? 'AND (cr.subject_id IS NULL OR sub.dept_id=?)' : ''} ORDER BY cr.created_at DESC LIMIT 20`, deptId ? [st.student_id, deptId] : [st.student_id]);
        out.requests = requests;
        const [[att]] = await db.query(`SELECT COUNT(*) AS days, SUM(status='present') AS present, SUM(status='absent') AS absent, SUM(status='late') AS late FROM attendance WHERE student_id=?`, [st.student_id]);
        out.attendance = Number(att.days) ? { days: Number(att.days), present: Number(att.present), absent: Number(att.absent), late: Number(att.late) } : null;
      }
    }

    if (user.role === 'teacher') {
      const [[tr]] = await db.query(`SELECT t.id AS teacher_id, t.staff_no, t.date_joined, d.dept_name AS department FROM teachers t LEFT JOIN departments d ON d.id=t.dept_id WHERE t.user_id=? LIMIT 1`, [userId]);
      out.teacher = tr || null;
      if (tr) {
        const [subjects] = await db.query(`SELECT sub.subject_name FROM teacher_subjects ts JOIN subjects sub ON sub.id=ts.subject_id WHERE ts.teacher_id=? ${deptId ? 'AND sub.dept_id=?' : ''} ORDER BY sub.subject_name`, deptId ? [tr.teacher_id, deptId] : [tr.teacher_id]);
        out.subjects = subjects;
        const [assignments] = await db.query(`SELECT sub.subject_name, cl.level_name AS class, a.arm_name AS arm,
            (SELECT COUNT(*) FROM students s2 JOIN users u2 ON u2.id=s2.user_id WHERE s2.class_level_id=tca.class_level_id AND s2.arm_id=tca.arm_id AND u2.is_active=1 AND s2.status IN ('active','repeating')) AS students
          FROM teacher_class_assignments tca JOIN subjects sub ON sub.id=tca.subject_id JOIN class_levels cl ON cl.id=tca.class_level_id JOIN arms a ON a.id=tca.arm_id
          WHERE tca.teacher_id=? AND tca.session_id=? ${deptId ? 'AND sub.dept_id=?' : ''} ORDER BY cl.sort_order, cl.id, a.arm_name, sub.subject_name`,
          deptId ? [tr.teacher_id, sessionId || 0, deptId] : [tr.teacher_id, sessionId || 0]);
        out.assignments = assignments.map(x => ({ ...x, students: Number(x.students) }));
        const [sheets] = await db.query(`SELECT t.term_name, ac.session_name, sub.subject_name, cl.level_name AS class, a.arm_name AS arm, COUNT(*) AS entered,
            SUM(r.is_approved=1) AS approved, SUM(r.is_approved=0 AND r.rejected_at IS NULL) AS pending, SUM(r.is_approved=0 AND r.rejected_at IS NOT NULL) AS rejected, MAX(r.updated_at) AS last_update
          FROM results r JOIN students s ON s.id=r.student_id JOIN class_levels cl ON cl.id=s.class_level_id JOIN arms a ON a.id=s.arm_id
          JOIN subjects sub ON sub.id=r.subject_id JOIN terms t ON t.id=r.term_id JOIN academic_sessions ac ON ac.id=t.session_id
          WHERE r.teacher_id=? ${deptId ? 'AND sub.dept_id=?' : ''} GROUP BY t.id, ac.id, sub.id, cl.id, a.id ORDER BY MAX(r.updated_at) DESC LIMIT 30`,
          deptId ? [tr.teacher_id, deptId] : [tr.teacher_id]);
        out.sheets = sheets.map(x => ({ ...x, entered: Number(x.entered), approved: Number(x.approved), pending: Number(x.pending), rejected: Number(x.rejected) }));
      }
    }

    // Account activity: things this person did, and things done to the account.
    const [activity] = await db.query(`SELECT l.action, l.logged_at, l.detail, actor.full_name AS actor_name, l.user_id = ? AS by_them
      FROM activity_log l LEFT JOIN users actor ON actor.id=l.user_id
      WHERE (l.user_id = ? OR (l.entity_type='user' AND l.entity_id = ?)) ${deptId ? "AND l.action NOT IN ('RESET_PASSWORD','DEACTIVATE_USER')" : ''} ORDER BY l.logged_at DESC, l.id DESC LIMIT 20`, [userId, userId, userId]);
    out.activity = activity.map(a => ({ action: a.action, logged_at: a.logged_at, actor_name: a.actor_name, by_them: !!a.by_them }));
    res.json(out);
  } catch (err) { console.error('[people/profile]', err); res.status(500).json({ error: 'Unable to load this profile.' }); }
});

module.exports = router;
