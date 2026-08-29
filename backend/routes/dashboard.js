const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const router = express.Router();
router.use(auth);

router.get('/stats', async (req, res) => {
  try {
    const [[students],[teachers],[hods],[results],[pending],[announcements]] = await Promise.all([
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

router.get('/top-performers', async (req, res) => {
  if (req.user.role !== 'commandant') return res.status(403).json({ error: 'Commandant access required.' });
  try {
    const [rows] = await db.query(`SELECT u.user_code,u.full_name,cl.level_name AS class,a.arm_name AS arm,ROUND(AVG(r.total_score),1) avg_score,COUNT(r.id) subjects_taken
      FROM results r JOIN students s ON s.id=r.student_id JOIN users u ON u.id=s.user_id JOIN class_levels cl ON cl.id=s.class_level_id JOIN arms a ON a.id=s.arm_id
      WHERE r.is_approved=1 GROUP BY r.student_id ORDER BY avg_score DESC LIMIT 20`);
    res.json(rows);
  } catch(err){ console.error('[dashboard/top]',err); res.status(500).json({error:'Unable to load top performers.'}); }
});

module.exports = router;
