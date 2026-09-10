const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const router = express.Router();
router.use(auth);

async function teacherIdForUser(userId) {
  const [[row]] = await db.query('SELECT id, dept_id FROM teachers WHERE user_id=? LIMIT 1', [userId]);
  return row || null;
}

router.get('/assignments', async (req, res) => {
  if (!['teacher','admin','commandant','hod'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden.' });
  try {
    const teacher = req.user.role === 'teacher' ? await teacherIdForUser(req.user.id) : null;
    const [rows] = await db.query(`SELECT tca.id,tca.teacher_id,tca.subject_id,s.subject_name,tca.class_level_id,cl.level_name AS class_name,tca.arm_id,a.arm_name,
      tca.session_id,ac.session_name FROM teacher_class_assignments tca JOIN subjects s ON s.id=tca.subject_id JOIN class_levels cl ON cl.id=tca.class_level_id
      JOIN arms a ON a.id=tca.arm_id JOIN academic_sessions ac ON ac.id=tca.session_id
      WHERE s.is_active=1 AND (? IS NULL OR tca.teacher_id=?) ORDER BY ac.start_date DESC,cl.id,a.arm_name,s.subject_name`, [teacher?.id ?? null, teacher?.id ?? null]);
    res.json(rows);
  } catch (err) { console.error('[results/assignments]', err); res.status(500).json({ error: 'Unable to load teaching assignments.' }); }
});

router.post('/upload', async (req, res) => {
  if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Only teachers can upload results.' });
  const student_code = String(req.body?.student_code || '').trim().toUpperCase();
  const subject_name = String(req.body?.subject_name || '').trim();
  const term_id = Number(req.body?.term_id);
  const ca_score = Number(req.body?.ca_score);
  const exam_score = Number(req.body?.exam_score);
  if (!student_code || !subject_name || !Number.isInteger(term_id) || !Number.isFinite(ca_score) || !Number.isFinite(exam_score)) return res.status(400).json({ error: 'Student, subject, term and numeric scores are required.' });
  if (ca_score < 0 || ca_score > 30 || exam_score < 0 || exam_score > 70) return res.status(400).json({ error: 'CA must be 0–30 and exam must be 0–70.' });

  const conn = await db.getConnection();
  try {
    const [[teacher]] = await conn.query('SELECT id FROM teachers WHERE user_id=? LIMIT 1', [req.user.id]);
    const [[student]] = await conn.query('SELECT s.id,class_level_id,arm_id FROM students s JOIN users u ON u.id=s.user_id WHERE u.user_code=? AND u.is_active=1 LIMIT 1', [student_code]);
    const [[subject]] = await conn.query('SELECT id FROM subjects WHERE subject_name=? AND is_active=1 LIMIT 1', [subject_name]);
    const [[term]] = await conn.query('SELECT id,session_id,result_locked FROM terms WHERE id=? LIMIT 1', [term_id]);
    if (!teacher) return res.status(404).json({ error: 'Teacher record not found.' });
    if (!student) return res.status(404).json({ error: 'Student not found.' });
    if (!subject) return res.status(404).json({ error: 'Subject not found.' });
    if (!term) return res.status(404).json({ error: 'Academic term not found.' });
    if (term.result_locked) return res.status(409).json({ error: 'This term is locked and cannot be edited.' });

    const [assignment] = await conn.query(`SELECT id FROM teacher_class_assignments WHERE teacher_id=? AND subject_id=? AND class_level_id=? AND arm_id=? AND session_id=? LIMIT 1`,
      [teacher.id, subject.id, student.class_level_id, student.arm_id, term.session_id]);
    if (!assignment.length) return res.status(403).json({ error: 'You are not assigned to this subject and class.' });

    await conn.beginTransaction();
    await conn.query(`INSERT INTO results (student_id,subject_id,term_id,teacher_id,ca_score,exam_score,is_approved)
      VALUES (?,?,?,?,?,?,0) ON DUPLICATE KEY UPDATE ca_score=VALUES(ca_score),exam_score=VALUES(exam_score),teacher_id=VALUES(teacher_id),is_approved=0,approved_by=NULL,approved_at=NULL,updated_at=CURRENT_TIMESTAMP`,
      [student.id, subject.id, term.id, teacher.id, ca_score, exam_score]);
    await conn.query(`INSERT INTO result_approval_log(result_id,action,actor_id,note) SELECT r.id,'revised',?,? FROM results r WHERE r.student_id=? AND r.subject_id=? AND r.term_id=?`,
      [req.user.id, 'Score submitted/revised by teacher', student.id, subject.id, term.id]);
    await conn.commit();
    res.json({ message: 'Score saved and sent for HOD approval.' });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    console.error('[results/upload]', err); res.status(500).json({ error: 'Unable to save score.' });
  } finally { conn.release(); }
});


router.get('/ai-status', async (req, res) => {
  if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Only teachers can use score-sheet import.' });
  const enabled = String(process.env.AI_SCORE_IMPORT_ENABLED || 'true').toLowerCase() !== 'false';
  if (!enabled) return res.json({ enabled: false, available: false, model: process.env.OLLAMA_VISION_MODEL || 'qwen3-vl:2b-instruct' });
  const base = String(process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const model = process.env.OLLAMA_VISION_MODEL || 'qwen3-vl:2b-instruct';
  try {
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) throw new Error('Ollama unavailable');
    const data = await r.json();
    const available = Array.isArray(data.models) && data.models.some(m => m.name === model || m.name?.startsWith(`${model}:`));
    res.json({ enabled: true, available, model });
  } catch { res.json({ enabled: true, available: false, model }); }
});

router.post('/ai-import', async (req, res) => {
  if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Only teachers can import score sheets.' });
  const enabled = String(process.env.AI_SCORE_IMPORT_ENABLED || 'true').toLowerCase() !== 'false';
  if (!enabled) return res.status(503).json({ error: 'AI score import is disabled. Use manual score entry.' });
  const assignmentId = Number(req.body?.assignment_id);
  const termId = Number(req.body?.term_id);
  const image = String(req.body?.image || '');
  if (!Number.isInteger(assignmentId) || assignmentId < 1) return res.status(400).json({ error: 'Select a valid teaching assignment.' });
  if (!Number.isInteger(termId) || termId < 1) return res.status(400).json({ error: 'Select an unlocked academic term.' });
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+$/.test(image)) return res.status(400).json({ error: 'Upload a JPG, PNG or WebP score-sheet image.' });
  if (image.length > 10 * 1024 * 1024) return res.status(413).json({ error: 'Score-sheet image is too large. Use an image under 7 MB.' });

  const teacher = await teacherIdForUser(req.user.id);
  if (!teacher) return res.status(404).json({ error: 'Teacher record not found.' });
  try {
    const [[assignment]] = await db.query(`SELECT tca.id,tca.subject_id,tca.class_level_id,tca.arm_id,tca.session_id,s.subject_name,cl.level_name AS class_name,a.arm_name
      FROM teacher_class_assignments tca JOIN subjects s ON s.id=tca.subject_id JOIN class_levels cl ON cl.id=tca.class_level_id JOIN arms a ON a.id=tca.arm_id
      WHERE tca.id=? AND tca.teacher_id=? LIMIT 1`, [assignmentId, teacher.id]);
    if (!assignment) return res.status(403).json({ error: 'That assignment is not assigned to your account.' });
    const [[term]] = await db.query('SELECT id,session_id,result_locked,term_name FROM terms WHERE id=? LIMIT 1', [termId]);
    if (!term) return res.status(404).json({ error: 'Academic term not found.' });
    if (term.result_locked) return res.status(409).json({ error: 'This academic term is locked.' });
    if (term.session_id !== assignment.session_id) return res.status(400).json({ error: 'The selected term does not belong to this teaching assignment session.' });
    const [students] = await db.query(`SELECT u.user_code, u.full_name FROM students st JOIN users u ON u.id=st.user_id
      WHERE u.is_active=1 AND st.class_level_id=? AND st.arm_id=? ORDER BY u.full_name`, [assignment.class_level_id, assignment.arm_id]);
    if (!students.length) return res.status(409).json({ error: 'No active students were found for this class and arm.' });

    const roster = students.map((x,i)=>`${i+1}. ${x.user_code} | ${x.full_name}`).join('\n');
    const prompt = `You are extracting an academic score sheet. The teacher selected ${assignment.class_name} ${assignment.arm_name}, subject ${assignment.subject_name}.\n\nKNOWN STUDENT ROSTER:\n${roster}\n\nRead the visible rows. Return ONLY JSON in this exact shape: {"rows":[{"user_code":"...","ca_score":0,"exam_score":0,"confidence":0.0,"note":""}]}. Match only to the supplied roster. Do not invent students or scores. If a value is unclear, set that score to null and explain in note. Confidence is 0 to 1. Scores must be numbers or null. This is a draft for teacher verification, not an official result.`;
    const base=String(process.env.OLLAMA_URL||'http://127.0.0.1:11434').replace(/\/$/,'');
    const model=process.env.OLLAMA_VISION_MODEL||'qwen3-vl:2b-instruct';
    const response=await fetch(`${base}/api/chat`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({model,messages:[{role:'user',content:prompt,images:[image.split(',')[1]]}],stream:false,format:'json',options:{temperature:0}}), signal:AbortSignal.timeout(Number(process.env.OLLAMA_TIMEOUT_MS||90000)) });
    if(!response.ok) { const text=await response.text(); console.error('[results/ai-import]',text.slice(0,500)); return res.status(503).json({error:'AI service is unavailable. Use manual score entry.'}); }
    const data=await response.json();
    let parsed; try { parsed=JSON.parse(data.message?.content||'{}'); } catch { return res.status(502).json({error:'The AI returned an unreadable response. Please retry or use manual entry.'}); }
    const known=new Map(students.map(x=>[x.user_code,{...x}]));
    const rows=Array.isArray(parsed.rows)?parsed.rows.map(r=>({
      user_code:String(r.user_code||'').trim().toUpperCase(), full_name:known.get(String(r.user_code||'').trim().toUpperCase())?.full_name||null,
      ca_score:r.ca_score===null||r.ca_score===undefined?null:Number(r.ca_score), exam_score:r.exam_score===null||r.exam_score===undefined?null:Number(r.exam_score), confidence:Number(r.confidence||0), note:String(r.note||'')
    })).filter(r=>known.has(r.user_code)).map(r=>({...r, valid_ca:Number.isFinite(r.ca_score)&&r.ca_score>=0&&r.ca_score<=30,valid_exam:Number.isFinite(r.exam_score)&&r.exam_score>=0&&r.exam_score<=70})) : [];
    res.json({assignment:{id:assignment.id,class_name:assignment.class_name,arm_name:assignment.arm_name,subject_name:assignment.subject_name}, term_id:term.id, term_name:term.term_name, rows, roster_count:students.length, extracted_count:rows.length, model});
  } catch(err) { console.error('[results/ai-import]',err); res.status(503).json({error:'AI score import is unavailable right now. Use manual score entry.'}); }
});

router.get('/pending', async (req, res) => {
  if (!['hod','admin','commandant'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden.' });
  try {
    let deptFilter = '';
    const params = [];
    if (req.user.role === 'hod') { deptFilter = 'AND tch.dept_id = (SELECT dept_id FROM hods WHERE user_id=?)'; params.push(req.user.id); }
    const [rows] = await db.query(`SELECT r.id,su.user_code AS student_code,su.full_name AS student_name,sub.subject_name,cl.level_name AS class_name,a.arm_name,
      t.term_name,ac.session_name,r.ca_score,r.exam_score,r.total_score,r.grade,r.remark,r.uploaded_at,tu.full_name AS teacher_name
      FROM results r JOIN students s ON s.id=r.student_id JOIN users su ON su.id=s.user_id JOIN subjects sub ON sub.id=r.subject_id JOIN teachers tch ON tch.id=r.teacher_id
      JOIN users tu ON tu.id=tch.user_id JOIN class_levels cl ON cl.id=s.class_level_id JOIN arms a ON a.id=s.arm_id JOIN terms t ON t.id=r.term_id JOIN academic_sessions ac ON ac.id=t.session_id
      WHERE r.is_approved=0 ${deptFilter} ORDER BY r.updated_at ASC`, params);
    res.json(rows);
  } catch (err) { console.error('[results/pending]', err); res.status(500).json({ error: 'Unable to load pending results.' }); }
});

router.put('/approve/:resultId', async (req, res) => {
  if (req.user.role !== 'hod') return res.status(403).json({ error: 'Only HODs can approve results.' });
  const resultId = Number(req.params.resultId);
  if (!Number.isInteger(resultId)) return res.status(400).json({ error: 'Invalid result ID.' });
  const conn = await db.getConnection();
  try {
    const [[row]] = await conn.query(`SELECT r.id,r.is_approved,t.result_locked,tch.dept_id FROM results r JOIN terms t ON t.id=r.term_id JOIN teachers tch ON tch.id=r.teacher_id WHERE r.id=? LIMIT 1`, [resultId]);
    const [[hod]] = await conn.query('SELECT dept_id FROM hods WHERE user_id=? LIMIT 1', [req.user.id]);
    if (!row || !hod) return res.status(404).json({ error: 'Result or HOD record not found.' });
    if (row.dept_id !== hod.dept_id) return res.status(403).json({ error: 'This result belongs to another department.' });
    if (row.result_locked) return res.status(409).json({ error: 'This term is locked.' });
    if (row.is_approved) return res.json({ message: 'Result was already approved.' });
    await conn.beginTransaction();
    await conn.query('UPDATE results SET is_approved=1,approved_by=?,approved_at=NOW() WHERE id=?', [req.user.id, resultId]);
    await conn.query('INSERT INTO result_approval_log(result_id,action,actor_id,note) VALUES (?,?,?,?)', [resultId,'approved',req.user.id,req.body?.note || null]);
    await conn.commit();
    res.json({ message: 'Result approved.' });
  } catch (err) { await conn.rollback(); console.error('[results/approve]', err); res.status(500).json({ error: 'Unable to approve result.' }); }
  finally { conn.release(); }
});

router.get('/student/:studentCode', async (req, res) => {
  const studentCode = String(req.params.studentCode || '').trim().toUpperCase();
  if (req.user.role === 'student' && req.user.user_code !== studentCode) return res.status(403).json({ error: 'You can only view your own results.' });
  try {
    const canSeePending = ['teacher','hod','admin','commandant'].includes(req.user.role);
    const [rows] = await db.query(`SELECT r.id,sub.subject_name,t.term_name,t.term_number,ac.session_name,r.ca_score,r.exam_score,r.total_score,r.grade,r.remark,r.is_approved,r.uploaded_at,r.approved_at
      FROM results r JOIN subjects sub ON sub.id=r.subject_id JOIN terms t ON t.id=r.term_id JOIN academic_sessions ac ON ac.id=t.session_id JOIN students s ON s.id=r.student_id JOIN users u ON u.id=s.user_id
      WHERE u.user_code=? AND (r.is_approved=1 OR ?) ORDER BY ac.start_date DESC,t.term_number DESC,sub.subject_name`, [studentCode, canSeePending ? 1 : 0]);
    res.json(rows);
  } catch (err) { console.error('[results/student]', err); res.status(500).json({ error: 'Unable to load results.' }); }
});

module.exports = router;
