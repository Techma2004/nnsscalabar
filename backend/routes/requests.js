'use strict';
/*
 * Student change requests: move to another arm, add a subject, or drop a subject.
 *
 *   Student   POST /api/requests              send a request
 *             GET  /api/requests/mine         see their requests and what was decided
 *             PATCH /api/requests/:id/cancel  withdraw a request still waiting
 *   Reviewer  GET  /api/requests/review       the queue (HOD: subject requests of their
 *                                             department and every arm request; Admin /
 *                                             Commandant: everything)
 *             PATCH /api/requests/:id/decision accept or decline, with a note
 *
 * Accepting a request makes the change straight away, inside one transaction.
 */
const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const v = require('../validate');
const { routeLimiter } = require('../middleware/security');
const router = express.Router();
router.use(routeLimiter(200, 'Too many requests. Please try again later.'));
router.use(auth);

const TYPES = ['arm', 'subject_add', 'subject_drop'];
const MANAGEMENT = ['admin', 'commandant'];

async function currentSession() {
  const [[row]] = await db.query('SELECT id, session_name FROM academic_sessions WHERE is_current=1 ORDER BY start_date DESC LIMIT 1');
  return row || null;
}
async function studentOf(userId) {
  const [[row]] = await db.query(`SELECT s.id, s.class_level_id, s.arm_id, s.track, s.status, cl.is_junior FROM students s JOIN class_levels cl ON cl.id=s.class_level_id WHERE s.user_id=? LIMIT 1`, [userId]);
  return row || null;
}

const SELECT_REQUEST = `SELECT cr.id, cr.request_type, cr.status, cr.reason, cr.review_note, cr.created_at, cr.reviewed_at,
    cr.target_arm_id, ta.arm_name AS target_arm, cr.subject_id, sub.subject_name, sub.dept_id, d.dept_name,
    su.id AS student_user_id, su.full_name AS student_name, su.user_code AS student_code, cl.level_name AS class, ca.arm_name AS current_arm, ru.full_name AS reviewed_by_name
  FROM change_requests cr
  JOIN students s ON s.id=cr.student_id JOIN users su ON su.id=s.user_id JOIN class_levels cl ON cl.id=s.class_level_id JOIN arms ca ON ca.id=s.arm_id
  LEFT JOIN arms ta ON ta.id=cr.target_arm_id LEFT JOIN subjects sub ON sub.id=cr.subject_id LEFT JOIN departments d ON d.id=sub.dept_id
  LEFT JOIN users ru ON ru.id=cr.reviewed_by`;

router.get('/options', async (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Only students can send change requests.' });
  try {
    const student = await studentOf(req.user.id); const session = await currentSession();
    if (!student || !session) return res.json({ arms: [], subjects: [], enrolled: [] });
    const [arms] = await db.query('SELECT id, arm_name, arm_type, category FROM arms WHERE is_active=1 AND id<>? ORDER BY arm_name', [student.arm_id]);
    const [subjects] = await db.query('SELECT s.id, s.subject_name, d.dept_name FROM subjects s LEFT JOIN departments d ON d.id=s.dept_id WHERE s.is_active=1 ORDER BY s.subject_name');
    const [enrolled] = await db.query(`SELECT subject_id FROM student_subject_enrollment WHERE student_id=? AND session_id=? AND is_active=1`, [student.id, session.id]);
    res.json({ arms, subjects, enrolled: enrolled.map(r => r.subject_id), session: session.session_name });
  } catch (err) { console.error('[requests/options]', err); res.status(500).json({ error: 'Unable to load the request form.' }); }
});

router.get('/mine', async (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Only students have change requests.' });
  try {
    const student = await studentOf(req.user.id);
    if (!student) return res.json({ rows: [] });
    const [rows] = await db.query(`${SELECT_REQUEST} WHERE cr.student_id=? ORDER BY cr.created_at DESC, cr.id DESC LIMIT 50`, [student.id]);
    res.json({ rows });
  } catch (err) { console.error('[requests/mine]', err); res.status(500).json({ error: 'Unable to load your requests.' }); }
});

router.post('/', async (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Only students can send change requests.' });
  const type = String(req.body?.request_type || '');
  const reason = v.optText(req.body?.reason, 500);
  if (!TYPES.includes(type)) return res.status(400).json({ error: 'Choose what you want to change.' });
  if (!reason || reason.length < 5) return res.status(400).json({ error: 'Tell your HOD why, in a sentence or two.' });
  try {
    const student = await studentOf(req.user.id); const session = await currentSession();
    if (!student) return res.status(404).json({ error: 'Student record not found.' });
    if (!['active', 'repeating'].includes(student.status)) return res.status(409).json({ error: 'Only current students can send change requests.' });
    if (!session) return res.status(409).json({ error: 'No current academic session is set up yet.' });
    let armId = null, subjectId = null;
    if (type === 'arm') {
      armId = v.id(req.body?.target_arm_id);
      if (!armId) return res.status(400).json({ error: 'Choose the arm you want to move to.' });
      const [[arm]] = await db.query('SELECT id FROM arms WHERE id=? AND is_active=1 LIMIT 1', [armId]);
      if (!arm) return res.status(400).json({ error: 'That arm is not available.' });
      if (armId === student.arm_id) return res.status(400).json({ error: 'You are already in that arm.' });
    } else {
      subjectId = v.id(req.body?.subject_id);
      if (!subjectId) return res.status(400).json({ error: 'Choose a subject.' });
      const [[sub]] = await db.query('SELECT id FROM subjects WHERE id=? AND is_active=1 LIMIT 1', [subjectId]);
      if (!sub) return res.status(400).json({ error: 'That subject is not offered.' });
      const [[enr]] = await db.query('SELECT 1 AS ok FROM student_subject_enrollment WHERE student_id=? AND subject_id=? AND session_id=? AND is_active=1 LIMIT 1', [student.id, subjectId, session.id]);
      if (type === 'subject_add' && enr) return res.status(400).json({ error: 'You already take that subject.' });
      if (type === 'subject_drop' && !enr) return res.status(400).json({ error: 'You are not enrolled in that subject.' });
    }
    const [[dup]] = await db.query(`SELECT id FROM change_requests WHERE student_id=? AND status='pending' AND request_type=? AND (? IS NULL OR subject_id=?) LIMIT 1`, [student.id, type, subjectId, subjectId]);
    if (dup) return res.status(409).json({ error: 'You already have a request like this waiting for review.' });
    await db.query('INSERT INTO change_requests (student_id, session_id, request_type, target_arm_id, subject_id, reason) VALUES (?,?,?,?,?,?)', [student.id, session.id, type, armId, subjectId, reason]);
    res.status(201).json({ message: 'Request sent. Your HOD will review it.' });
  } catch (err) { console.error('[requests/create]', err); res.status(500).json({ error: 'Unable to send your request.' }); }
});

router.patch('/:id/cancel', async (req, res) => {
  const id = v.id(req.params.id);
  if (req.user.role !== 'student' || !id) return res.status(400).json({ error: 'Invalid request.' });
  try {
    const student = await studentOf(req.user.id);
    const [r] = await db.query(`UPDATE change_requests SET status='cancelled' WHERE id=? AND student_id=? AND status='pending'`, [id, student?.id || 0]);
    if (!r.affectedRows) return res.status(409).json({ error: 'That request can no longer be withdrawn.' });
    res.json({ message: 'Request withdrawn.' });
  } catch (err) { console.error('[requests/cancel]', err); res.status(500).json({ error: 'Unable to withdraw the request.' }); }
});

async function reviewerScope(user) {
  if (MANAGEMENT.includes(user.role)) return { all: true };
  if (user.role === 'hod') {
    const [[hod]] = await db.query('SELECT dept_id FROM hods WHERE user_id=? LIMIT 1', [user.id]);
    if (!hod) return { error: 'No department is assigned to your account.' };
    return { deptId: hod.dept_id };
  }
  return { error: 'Only heads of department and management review change requests.', status: 403 };
}
// Subject requests belong to the subject's department. Arm requests have no
// department, so any HOD (or management) may decide them.
const scopeSql = scope => (scope.all ? '' : 'AND (cr.request_type=\'arm\' OR sub.dept_id=?)');

router.get('/review', async (req, res) => {
  try {
    const scope = await reviewerScope(req.user);
    if (scope.error) return res.status(scope.status || 404).json({ error: scope.error });
    const status = req.query.status === 'all' ? '' : "AND cr.status='pending'";
    const [rows] = await db.query(`${SELECT_REQUEST} WHERE 1=1 ${status} ${scopeSql(scope)} ORDER BY cr.status='pending' DESC, cr.created_at DESC LIMIT 200`, scope.all ? [] : [scope.deptId]);
    res.json({ rows });
  } catch (err) { console.error('[requests/review]', err); res.status(500).json({ error: 'Unable to load requests.' }); }
});

router.patch('/:id/decision', async (req, res) => {
  const id = v.id(req.params.id);
  const decision = req.body?.decision;
  const note = v.optText(req.body?.note, 500);
  if (!id || !['approved', 'declined'].includes(decision)) return res.status(400).json({ error: 'Choose accept or decline.' });
  if (note === undefined) return res.status(400).json({ error: 'The note is too long (500 characters at most).' });
  if (decision === 'declined' && !note) return res.status(400).json({ error: 'Give a short reason so the student understands.' });
  const scope = await reviewerScope(req.user);
  if (scope.error) return res.status(scope.status || 404).json({ error: scope.error });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[cr]] = await conn.query(`SELECT cr.*, sub.dept_id FROM change_requests cr LEFT JOIN subjects sub ON sub.id=cr.subject_id WHERE cr.id=? FOR UPDATE`, [id]);
    if (!cr) { await conn.rollback(); return res.status(404).json({ error: 'Request not found.' }); }
    if (!scope.all && cr.request_type !== 'arm' && cr.dept_id !== scope.deptId) { await conn.rollback(); return res.status(403).json({ error: 'That request belongs to another department.' }); }
    if (cr.status !== 'pending') { await conn.rollback(); return res.status(409).json({ error: `This request was already ${cr.status}.` }); }

    if (decision === 'approved') {
      const [[st]] = await conn.query(`SELECT s.id, s.arm_id, s.track, s.class_level_id, cl.is_junior FROM students s JOIN class_levels cl ON cl.id=s.class_level_id WHERE s.id=? FOR UPDATE`, [cr.student_id]);
      if (cr.request_type === 'arm') {
        const [[arm]] = await conn.query('SELECT id, arm_type FROM arms WHERE id=? AND is_active=1 LIMIT 1', [cr.target_arm_id]);
        if (!arm) { await conn.rollback(); return res.status(409).json({ error: 'The arm the student asked for is no longer available.' }); }
        const newTrack = st.is_junior ? 'junior' : arm.arm_type;
        await conn.query('UPDATE students SET arm_id=?, track=? WHERE id=?', [arm.id, newTrack, st.id]);
        if (newTrack !== st.track) {
          // New track: enrol in its subjects, and drop old ones only when nothing has been recorded for them.
          await conn.query(`INSERT IGNORE INTO student_subject_enrollment(student_id,subject_id,session_id,enrolled_by) SELECT ?,ts.subject_id,?,? FROM track_subjects ts WHERE ts.track=?`, [st.id, cr.session_id, req.user.id, newTrack]);
          await conn.query(`DELETE e FROM student_subject_enrollment e WHERE e.student_id=? AND e.session_id=? AND e.subject_id NOT IN (SELECT subject_id FROM track_subjects WHERE track=?)
            AND NOT EXISTS (SELECT 1 FROM results r JOIN terms t ON t.id=r.term_id WHERE r.student_id=e.student_id AND r.subject_id=e.subject_id AND t.session_id=e.session_id)`, [st.id, cr.session_id, newTrack]);
        }
      } else if (cr.request_type === 'subject_add') {
        await conn.query(`INSERT INTO student_subject_enrollment(student_id,subject_id,session_id,enrolled_by) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE is_active=1, enrolled_by=VALUES(enrolled_by)`, [st.id, cr.subject_id, cr.session_id, req.user.id]);
      } else {
        const [[used]] = await conn.query(`SELECT COUNT(*) AS n FROM results r JOIN terms t ON t.id=r.term_id WHERE r.student_id=? AND r.subject_id=? AND t.session_id=?`, [st.id, cr.subject_id, cr.session_id]);
        if (Number(used.n) > 0) { await conn.rollback(); return res.status(409).json({ error: 'This subject already has recorded results this session, so it cannot be dropped. Decline the request and explain why.' }); }
        await conn.query('UPDATE student_subject_enrollment SET is_active=0 WHERE student_id=? AND subject_id=? AND session_id=?', [st.id, cr.subject_id, cr.session_id]);
      }
    }
    await conn.query('UPDATE change_requests SET status=?, reviewed_by=?, review_note=?, reviewed_at=NOW() WHERE id=?', [decision, req.user.id, note, id]);
    await conn.query('INSERT INTO activity_log (user_id, action, entity_type, entity_id, detail) VALUES (?,?,?,?,?)', [req.user.id, decision === 'approved' ? 'APPROVE_CHANGE_REQUEST' : 'DECLINE_CHANGE_REQUEST', 'change_request', id, JSON.stringify({ type: cr.request_type })]);
    await conn.commit();
    res.json({ message: decision === 'approved' ? 'Request accepted and the change has been made.' : 'Request declined.' });
  } catch (err) {
    await conn.rollback(); console.error('[requests/decision]', err);
    res.status(500).json({ error: 'Unable to record the decision.' });
  } finally { conn.release(); }
});

module.exports = router;
