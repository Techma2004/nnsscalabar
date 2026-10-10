const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const sheets = require('../sheets');
const router = express.Router();
router.use(auth);

router.get('/stats', async (req, res) => {
  try {
    // School-wide figures are management information. A teacher or student was
    // previously handed the whole school's headcounts and result totals, which
    // contradicts departmental isolation. Each role now gets figures scoped to
    // what it is actually responsible for.
    if (req.user.role === 'teacher') {
      const [[[students]], [[subjects]], [[pending]], [[approved]], [[announcements]]] = await Promise.all([
        db.query(`SELECT COUNT(DISTINCT st.id) total FROM teacher_class_assignments tca
          JOIN teachers t ON t.id=tca.teacher_id JOIN students st ON st.class_level_id=tca.class_level_id AND st.arm_id=tca.arm_id
          JOIN users su ON su.id=st.user_id JOIN academic_sessions ac ON ac.id=tca.session_id
          WHERE t.user_id=? AND su.is_active=1 AND st.status='active' AND ac.is_current=1`, [req.user.id]),
        db.query(`SELECT COUNT(DISTINCT ts.subject_id) total FROM teacher_subjects ts JOIN teachers t ON t.id=ts.teacher_id WHERE t.user_id=?`, [req.user.id]),
        db.query(`SELECT COUNT(*) total FROM results r JOIN teachers t ON t.id=r.teacher_id WHERE t.user_id=? AND r.is_approved=0`, [req.user.id]),
        db.query(`SELECT COUNT(*) total FROM results r JOIN teachers t ON t.id=r.teacher_id WHERE t.user_id=? AND r.is_approved=1`, [req.user.id]),
        db.query(`SELECT COUNT(*) total FROM announcements WHERE publish_at<=NOW() AND (expires_at IS NULL OR expires_at>NOW()) AND FIND_IN_SET('teacher', audience)>0`)
      ]);
      return res.json({ students: students.total, subjects: subjects.total, pending_results: pending.total, results: approved.total, active_announcements: announcements.total });
    }
    if (req.user.role === 'student') {
      const [[announcements]] = await db.query(`SELECT COUNT(*) total FROM announcements WHERE publish_at<=NOW() AND (expires_at IS NULL OR expires_at>NOW()) AND FIND_IN_SET('student', audience)>0`);
      return res.json({ active_announcements: announcements.total });
    }
    const [[[students]],[[teachers]],[[hods]],[[results]],[[pending]],[[announcements]]] = await Promise.all([
      db.query('SELECT COUNT(*) total FROM students s JOIN users u ON u.id=s.user_id WHERE u.is_active=1'),
      db.query('SELECT COUNT(*) total FROM teachers t JOIN users u ON u.id=t.user_id WHERE u.is_active=1'),
      db.query('SELECT COUNT(*) total FROM hods h JOIN users u ON u.id=h.user_id WHERE u.is_active=1'),
      db.query('SELECT COUNT(*) total FROM results WHERE is_approved=1'),
      db.query('SELECT COUNT(*) total FROM results WHERE is_approved=0'),
      db.query('SELECT COUNT(*) total FROM announcements WHERE publish_at<=NOW() AND (expires_at IS NULL OR expires_at>NOW())')
    ]);
    res.json({ students: students.total, teachers: teachers.total, hods: hods.total, results: results.total, pending_results: pending.total, active_announcements: announcements.total });
  } catch (err) { console.error('[dashboard/stats]', err); res.status(500).json({ error: 'Unable to load dashboard statistics.' }); }
});

router.get('/student-summary', async (req,res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error:'Forbidden.' });
  try {
    const [[student]] = await db.query('SELECT id,class_level_id,arm_id FROM students WHERE user_id=? LIMIT 1',[req.user.id]);
    if (!student) return res.status(404).json({error:'Student record not found.'});
    const [[summary]] = await db.query(`SELECT COUNT(*) subjects,ROUND(AVG(total_score),1) average,COUNT(CASE WHEN total_score>=50 THEN 1 END) passes FROM results WHERE student_id=? AND is_approved=1`,[student.id]);
    res.json(summary);
  } catch(err){ console.error('[dashboard/student-summary]',err); res.status(500).json({error:'Unable to load student summary.'}); }
});

// HODs were shown the same school-wide counters as an administrator, with no
// indication of which department they actually head — they had to infer it.
// This returns their own department and the figures that are actually theirs.
router.get('/hod-summary', async (req, res) => {
  if (req.user.role !== 'hod') return res.status(403).json({ error: 'Forbidden.' });
  try {
    const [[hod]] = await db.query(`SELECT h.id, h.dept_id, h.appointed_date, d.dept_name, d.description
      FROM hods h JOIN departments d ON d.id = h.dept_id WHERE h.user_id = ? LIMIT 1`, [req.user.id]);
    if (!hod) return res.status(404).json({ error: 'No department is assigned to your account. Contact an administrator.' });

    const [[[teachers]], [[subjects]], [[pending]], [[approved]]] = await Promise.all([
      db.query('SELECT COUNT(*) total FROM teachers t JOIN users u ON u.id=t.user_id WHERE t.dept_id=? AND u.is_active=1', [hod.dept_id]),
      db.query('SELECT COUNT(*) total FROM subjects WHERE dept_id=? AND is_active=1', [hod.dept_id]),
      db.query(`SELECT COUNT(*) total FROM results r JOIN subjects s ON s.id=r.subject_id WHERE s.dept_id=? AND r.is_approved=0`, [hod.dept_id]),
      db.query(`SELECT COUNT(*) total FROM results r JOIN subjects s ON s.id=r.subject_id WHERE s.dept_id=? AND r.is_approved=1`, [hod.dept_id])
    ]);

    res.json({
      dept_id: hod.dept_id,
      dept_name: hod.dept_name,
      description: hod.description,
      appointed_date: hod.appointed_date,
      teachers: teachers.total,
      subjects: subjects.total,
      pending_results: pending.total,
      approved_results: approved.total
    });
  } catch (err) { console.error('[dashboard/hod-summary]', err); res.status(500).json({ error: 'Unable to load department summary.' }); }
});

// Which term a dashboard request is about: the one asked for, otherwise the
// current term of the current session, otherwise the most recent term.
async function pickTerm(termId) {
  const base = `SELECT t.id, t.term_name, t.term_number, t.result_locked, t.is_current, ac.id AS session_id, ac.session_name
    FROM terms t JOIN academic_sessions ac ON ac.id=t.session_id`;
  if (Number.isInteger(termId) && termId > 0) { const [[t]] = await db.query(`${base} WHERE t.id=? LIMIT 1`, [termId]); return t || null; }
  const [[cur]] = await db.query(`${base} WHERE t.is_current=1 ORDER BY ac.is_current DESC, ac.start_date DESC LIMIT 1`);
  if (cur) return cur;
  const [[last]] = await db.query(`${base} ORDER BY ac.start_date DESC, t.term_number DESC LIMIT 1`);
  return last || null;
}
const num = v => (v === null || v === undefined ? null : Number(v));

// Everything the Commandant's dashboard shows, in one call. Approved results
// drive every performance figure - nothing unapproved is ever counted as a
// grade - while the pipeline and sheet-progress figures show how far the
// term's results have actually got.
router.get('/commandant-summary', async (req, res) => {
  if (req.user.role !== 'commandant') return res.status(403).json({ error: 'Commandant access required.' });
  try {
    const term = await pickTerm(Number(req.query.term_id));
    const [terms] = await db.query(`SELECT t.id, t.term_name, t.is_current, ac.session_name
      FROM terms t JOIN academic_sessions ac ON ac.id=t.session_id ORDER BY ac.start_date DESC, t.term_number DESC`);
    if (!term) return res.json({ term: null, terms });
    const tid = term.id;

    const [[[heads]], [[tch]], [[hods]], [[depts]], [[pipe]], [[perf]], [gradeRows], [classRows], [deptRows], index, [topRows]] = await Promise.all([
      db.query(`SELECT COUNT(*) total FROM students s JOIN users u ON u.id=s.user_id WHERE u.is_active=1 AND s.status IN ('active','repeating')`),
      db.query('SELECT COUNT(*) total FROM teachers t JOIN users u ON u.id=t.user_id WHERE u.is_active=1'),
      db.query('SELECT COUNT(*) total FROM hods h JOIN users u ON u.id=h.user_id WHERE u.is_active=1'),
      db.query('SELECT COUNT(*) total FROM departments'),
      db.query(`SELECT COUNT(*) total, COALESCE(SUM(is_approved=1),0) approved,
          COALESCE(SUM(is_approved=0 AND rejected_at IS NULL),0) pending, COALESCE(SUM(is_approved=0 AND rejected_at IS NOT NULL),0) rejected
        FROM results WHERE term_id=?`, [tid]),
      db.query(`SELECT COUNT(*) total, ROUND(AVG(total_score),1) average, ROUND(SUM(total_score>=50)/NULLIF(COUNT(*),0)*100,1) pass_rate
        FROM results WHERE term_id=? AND is_approved=1`, [tid]),
      db.query('SELECT grade, COUNT(*) n FROM results WHERE term_id=? AND is_approved=1 GROUP BY grade', [tid]),
      db.query(`SELECT cl.id AS class_level_id, cl.level_name AS class_name, a.arm_name, COUNT(DISTINCT s.id) students_scored, COUNT(r.id) results,
          ROUND(AVG(r.total_score),1) avg_score, ROUND(SUM(r.total_score>=50)/COUNT(*)*100,1) pass_rate
        FROM results r JOIN students s ON s.id=r.student_id JOIN class_levels cl ON cl.id=s.class_level_id JOIN arms a ON a.id=s.arm_id
        WHERE r.term_id=? AND r.is_approved=1 GROUP BY cl.id, a.id ORDER BY cl.sort_order, cl.id, a.arm_name`, [tid]),
      db.query(`SELECT d.id, d.dept_name, COUNT(r.id) AS results,
          COALESCE(SUM(r.is_approved=1),0) approved, COALESCE(SUM(r.is_approved=0 AND r.rejected_at IS NULL),0) pending,
          ROUND(AVG(CASE WHEN r.is_approved=1 THEN r.total_score END),1) avg_score,
          ROUND(SUM(r.is_approved=1 AND r.total_score>=50)/NULLIF(SUM(r.is_approved=1),0)*100,1) pass_rate
        FROM departments d LEFT JOIN subjects sub ON sub.dept_id=d.id LEFT JOIN results r ON r.subject_id=sub.id AND r.term_id=?
        GROUP BY d.id ORDER BY d.dept_name`, [tid]),
      sheets.sheetIndex(tid),
      db.query(`SELECT u.user_code, u.full_name, cl.level_name AS class, a.arm_name AS arm, ROUND(AVG(r.total_score),1) avg_score, COUNT(r.id) subjects_taken
        FROM results r JOIN students s ON s.id=r.student_id JOIN users u ON u.id=s.user_id JOIN class_levels cl ON cl.id=s.class_level_id JOIN arms a ON a.id=s.arm_id
        WHERE r.is_approved=1 AND r.term_id=? GROUP BY r.student_id ORDER BY avg_score DESC, subjects_taken DESC LIMIT 5`, [tid])
    ]);

    const sheetList = index ? index.sheets : [];
    const sheetCounts = { total: sheetList.length, approved: 0, submitted: 0, in_progress: 0, not_started: 0 };
    sheetList.forEach(x => { sheetCounts[x.status] += 1; });
    const behind = sheetList.filter(x => x.status === 'not_started' || x.status === 'in_progress')
      .sort((a, b) => (a.entered / (a.roster_count || 1)) - (b.entered / (b.roster_count || 1))).slice(0, 8);

    res.json({
      term: { id: term.id, term_name: term.term_name, session_name: term.session_name, result_locked: !!term.result_locked, is_current: !!term.is_current },
      terms,
      headcount: { students: heads.total, teachers: tch.total, hods: hods.total, departments: depts.total },
      pipeline: { total: num(pipe.total), approved: num(pipe.approved), pending: num(pipe.pending), rejected: num(pipe.rejected) },
      performance: { results: num(perf.total), average: num(perf.average), pass_rate: num(perf.pass_rate) },
      grades: gradeRows.map(g => ({ grade: g.grade, n: num(g.n) })),
      classes: classRows.map(c => ({ ...c, students_scored: num(c.students_scored), results: num(c.results), avg_score: num(c.avg_score), pass_rate: num(c.pass_rate) })),
      departments: deptRows.map(d => ({ ...d, results: num(d.results), approved: num(d.approved), pending: num(d.pending), avg_score: num(d.avg_score), pass_rate: num(d.pass_rate) })),
      sheets: { counts: sheetCounts, behind },
      top: topRows
    });
  } catch (err) { console.error('[dashboard/commandant-summary]', err); res.status(500).json({ error: 'Unable to load the school overview.' }); }
});

// Ranking of students by average approved score. Optional filters: term_id
// ('all' or omitted = every approved result), class_level_id, limit (<= 100).
router.get('/top-performers', async (req, res) => {
  if (req.user.role !== 'commandant') return res.status(403).json({ error: 'Commandant access required.' });
  try {
    const where = ['r.is_approved=1']; const params = [];
    const termId = Number(req.query.term_id);
    if (Number.isInteger(termId) && termId > 0) { where.push('r.term_id=?'); params.push(termId); }
    const classId = Number(req.query.class_level_id);
    if (Number.isInteger(classId) && classId > 0) { where.push('s.class_level_id=?'); params.push(classId); }
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const [rows] = await db.query(`SELECT u.user_code,u.full_name,cl.level_name AS class,a.arm_name AS arm,ROUND(AVG(r.total_score),1) avg_score,COUNT(r.id) subjects_taken
      FROM results r JOIN students s ON s.id=r.student_id JOIN users u ON u.id=s.user_id JOIN class_levels cl ON cl.id=s.class_level_id JOIN arms a ON a.id=s.arm_id
      WHERE ${where.join(' AND ')} GROUP BY r.student_id ORDER BY avg_score DESC, subjects_taken DESC LIMIT ?`, [...params, limit]);
    res.json(rows);
  } catch(err){ console.error('[dashboard/top]',err); res.status(500).json({error:'Unable to load top performers.'}); }
});

module.exports = router;
