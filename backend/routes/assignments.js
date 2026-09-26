const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const router = express.Router();
router.use(auth);
const MANAGEMENT = ['admin', 'commandant'];

async function session() {
  const [[row]] = await db.query('SELECT id, session_name FROM academic_sessions WHERE is_current=1 ORDER BY start_date DESC LIMIT 1');
  return row || null;
}
async function scope(req) {
  if (MANAGEMENT.includes(req.user.role)) return null;
  if (req.user.role !== 'hod') return null;
  const [[hod]] = await db.query('SELECT dept_id FROM hods WHERE user_id=? LIMIT 1', [req.user.id]);
  return hod?.dept_id || null;
}

router.get('/meta', async (req, res) => {
  if (!['admin','commandant','hod'].includes(req.user.role)) return res.status(403).json({error:'Assignment management is restricted to management and HOD accounts.'});
  try {
    const deptId = await scope(req);
    if (req.user.role === 'hod' && !deptId) return res.status(404).json({error:'No department is assigned to your HOD account.'});
    const current = await session();
    if (!current) return res.status(409).json({error:'No current academic session is configured.'});
    const teacherWhere = deptId ? 'AND t.dept_id=?' : '';
    const subjectWhere = deptId ? 'AND (s.dept_id=? OR s.dept_id IS NULL)' : '';
    const params = deptId ? [deptId] : [];
    const subjectParams = deptId ? [deptId] : [];
    const [teachers, subjects, classes, arms] = await Promise.all([
      db.query(`SELECT t.id teacher_id,u.user_code,u.full_name,d.dept_name department FROM teachers t JOIN users u ON u.id=t.user_id LEFT JOIN departments d ON d.id=t.dept_id WHERE u.is_active=1 ${teacherWhere} ORDER BY u.full_name`, params),
      db.query(`SELECT s.id,s.subject_name,s.dept_id,d.dept_name department FROM subjects s LEFT JOIN departments d ON d.id=s.dept_id WHERE s.is_active=1 ${subjectWhere} ORDER BY s.subject_name`, subjectParams),
      db.query('SELECT id,level_name,is_junior FROM class_levels ORDER BY sort_order,id'),
      db.query('SELECT id,arm_name,arm_type,category FROM arms WHERE is_active=1 ORDER BY arm_name')
    ]);
    res.json({session:current,teachers:teachers[0],subjects:subjects[0],classes:classes[0],arms:arms[0]});
  } catch (err) { console.error('[assignments/meta]',err); res.status(500).json({error:'Unable to load assignment configuration.'}); }
});

router.get('/teacher/:teacherId', async (req,res) => {
  const teacherId=Number(req.params.teacherId);
  if(!Number.isInteger(teacherId)||teacherId<1) return res.status(400).json({error:'Invalid teacher ID.'});
  try {
    const [[teacher]]=await db.query(`SELECT t.id teacher_id,t.dept_id,u.full_name,u.user_code,d.dept_name department FROM teachers t JOIN users u ON u.id=t.user_id LEFT JOIN departments d ON d.id=t.dept_id WHERE t.id=? LIMIT 1`,[teacherId]);
    if(!teacher) return res.status(404).json({error:'Teacher not found.'});
    const deptId=await scope(req);
    if(req.user.role==='teacher') { const [[own]]=await db.query('SELECT id FROM teachers WHERE id=? AND user_id=? LIMIT 1',[teacherId,req.user.id]); if(!own) return res.status(403).json({error:'You can only view your own assignments.'}); }
    else if(req.user.role==='hod' && teacher.dept_id!==deptId) return res.status(403).json({error:'That teacher is outside your department.'});
    else if(!['admin','commandant','hod'].includes(req.user.role)) return res.status(403).json({error:'Assignment access denied.'});
    const current=await session();
    if(!current) return res.status(409).json({error:'No current academic session is configured.'});
    const [subjects]=await db.query(`SELECT DISTINCT ts.subject_id,s.subject_name FROM teacher_subjects ts JOIN subjects s ON s.id=ts.subject_id WHERE ts.teacher_id=? ORDER BY s.subject_name`,[teacherId]);
    const [assignments]=await db.query(`SELECT tca.id,tca.subject_id,s.subject_name,tca.class_level_id,cl.level_name,tca.arm_id,a.arm_name,tca.session_id,ac.session_name FROM teacher_class_assignments tca JOIN subjects s ON s.id=tca.subject_id JOIN class_levels cl ON cl.id=tca.class_level_id JOIN arms a ON a.id=tca.arm_id JOIN academic_sessions ac ON ac.id=tca.session_id WHERE tca.teacher_id=? AND tca.session_id=? ORDER BY cl.sort_order,a.arm_name,s.subject_name`,[teacherId,current.id]);
    res.json({teacher,session:current,subjects,assignments});
  } catch(err) { console.error('[assignments/teacher]',err); res.status(500).json({error:'Unable to load teacher assignments.'}); }
});

router.put('/teacher/:teacherId', async (req,res) => {
  const teacherId=Number(req.params.teacherId);
  if(!Number.isInteger(teacherId)||teacherId<1) return res.status(400).json({error:'Invalid teacher ID.'});
  if(!['admin','commandant','hod'].includes(req.user.role)) return res.status(403).json({error:'Only management or the HOD can change teaching assignments.'});
  const subjectIds=[...new Set((Array.isArray(req.body?.subject_ids)?req.body.subject_ids:[]).map(Number).filter(n=>Number.isInteger(n)&&n>0))];
  const assignments=(Array.isArray(req.body?.assignments)?req.body.assignments:[]).map(x=>({subject_id:Number(x.subject_id),class_level_id:Number(x.class_level_id),arm_id:Number(x.arm_id)})).filter(x=>[x.subject_id,x.class_level_id,x.arm_id].every(n=>Number.isInteger(n)&&n>0));
  const conn=await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[teacher]]=await conn.query('SELECT id,dept_id FROM teachers WHERE id=? LIMIT 1',[teacherId]);
    if(!teacher){await conn.rollback();return res.status(404).json({error:'Teacher not found.'});}
    if(req.user.role==='hod'){const [[hod]]=await conn.query('SELECT dept_id FROM hods WHERE user_id=? LIMIT 1',[req.user.id]);if(!hod||hod.dept_id!==teacher.dept_id){await conn.rollback();return res.status(403).json({error:'You can only reassign teachers in your department.'});}}
    const current=await session();
    if(!current){await conn.rollback();return res.status(409).json({error:'No current academic session is configured.'});}
    const ids=[...new Set([...subjectIds,...assignments.map(x=>x.subject_id)])];
    if(ids.length){const [valid]=await conn.query(`SELECT id,dept_id FROM subjects WHERE is_active=1 AND id IN (${ids.map(()=>'?').join(',')})`,ids);if(valid.length!==ids.length) throw new Error('One or more selected subjects are invalid or inactive.');if(req.user.role==='hod'&&valid.some(s=>s.dept_id!==null&&s.dept_id!==teacher.dept_id)) throw new Error('A selected subject is outside the teacher department.');}
    for(const x of assignments){const [[mapped]]=await conn.query(`SELECT ts.id FROM track_subjects ts JOIN class_levels cl ON cl.id=? JOIN arms a ON a.id=? WHERE ts.track=CASE WHEN cl.is_junior=1 THEN 'junior' ELSE a.arm_type END AND ts.subject_id=? LIMIT 1`,[x.class_level_id,x.arm_id,x.subject_id]);if(!mapped) throw new Error('One or more assignments do not match the configured curriculum.');}
    await conn.query('DELETE FROM teacher_class_assignments WHERE teacher_id=? AND session_id=?',[teacherId,current.id]);
    for(const x of assignments) await conn.query('INSERT INTO teacher_class_assignments(teacher_id,subject_id,class_level_id,arm_id,session_id) VALUES(?,?,?,?,?)',[teacherId,x.subject_id,x.class_level_id,x.arm_id,current.id]);
    await conn.query('DELETE FROM teacher_subjects WHERE teacher_id=?',[teacherId]);
    for(const id of ids) await conn.query('INSERT INTO teacher_subjects(teacher_id,subject_id) VALUES(?,?)',[teacherId,id]);
    await conn.query('INSERT INTO activity_log(user_id,action,entity_type,entity_id,detail) VALUES(?,?,?,?,?)',[req.user.id,'UPDATE_TEACHER_ASSIGNMENTS','teacher',teacherId,JSON.stringify({session_id:current.id,subject_ids:ids,assignment_count:assignments.length})]);
    await conn.commit();
    res.json({message:'Teaching assignments updated.',teacher_id:teacherId,session_id:current.id,subject_ids:ids,assignments});
  } catch(err){await conn.rollback();if(/invalid|inactive|outside|curriculum/.test(err.message)) return res.status(400).json({error:err.message});console.error('[assignments/update]',err);res.status(500).json({error:'Unable to update teaching assignments.'});}
  finally{conn.release();}
});
module.exports=router;
