const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const db = require('../db');
const auth = require('../middleware/auth');
const router = express.Router();
router.use(auth);

const OCR_DIR = path.join(__dirname, '..', '..');
const OCR_SCRIPT = path.join(OCR_DIR, 'ocr_score_sheet.py');
// uv (https://docs.astral.sh/uv/) manages the Python venv and installs
// pyproject.toml dependencies automatically on first run — no manual pip
// install step on the server. Set OCR_RUNNER=python (with OCR_PYTHON_BIN
// pointing at an interpreter that already has pytesseract/Pillow installed)
// only if uv genuinely cannot be installed on a given machine.
const OCR_RUNNER = String(process.env.OCR_RUNNER || 'uv').toLowerCase();
const OCR_PYTHON_BIN = process.env.OCR_PYTHON_BIN || 'python3';
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS || 20000);

/** Runs the Tesseract OCR script as a subprocess. Resolves with the parsed
 * JSON the script prints, or rejects with a short, user-safe message —
 * never with raw stderr/stack details, which could leak server paths. */
function runOcr(imagePath, roster) {
  return new Promise((resolve, reject) => {
    const [cmd, args] = OCR_RUNNER === 'python'
      ? [OCR_PYTHON_BIN, [OCR_SCRIPT, imagePath]]
      : ['uv', ['run', '--project', OCR_DIR, OCR_SCRIPT, imagePath]];
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd: OCR_DIR });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('OCR timed out. Try a clearer, more evenly-lit photo.')); }, OCR_TIMEOUT_MS);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', err => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error(OCR_RUNNER === 'python' ? 'OCR is not installed on this server (python3 not found).' : 'OCR is not installed on this server (uv not found). Ask an administrator to install uv, or set OCR_RUNNER=python.'));
      } else {
        reject(new Error('OCR failed to start.'));
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // uv prints its own setup logs (venv creation, package downloads) to
      // stderr on first run, and pytesseract itself never writes to stdout
      // except our final JSON line — so stdout should always be clean. Fall
      // back to scanning stderr too only if stdout truly has nothing usable,
      // in case uv ever redirects an error there instead.
      let parsed;
      try { parsed = JSON.parse(stdout.trim().split('\n').pop()); }
      catch {
        try { parsed = JSON.parse(stderr.trim().split('\n').pop()); }
        catch {
          console.error('[ocr] unparseable output', { code, stdout, stderr });
          return reject(new Error('OCR returned an unreadable response. Try again or use manual entry.'));
        }
      }
      if (parsed.error) return reject(new Error(parsed.error));
      resolve(parsed);
    });
    child.stdin.write(JSON.stringify(roster));
    child.stdin.end();
  });
}

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
  if (!enabled) return res.json({ enabled: false, available: false, model: 'Tesseract OCR' });
  // Cheap readiness probe: actually invoking Tesseract's own version check is
  // more honest than pinging a network service, since OCR runs locally with
  // no server to be "down". Use the same runner (uv or raw python) as a real
  // scan would, so this reflects what will actually happen.
  try {
    await new Promise((resolve, reject) => {
      const [cmd, args] = OCR_RUNNER === 'python'
        ? [OCR_PYTHON_BIN, ['-c', 'import pytesseract; pytesseract.get_tesseract_version()']]
        : ['uv', ['run', '--project', OCR_DIR, 'python', '-c', 'import pytesseract; pytesseract.get_tesseract_version()']];
      const child = spawn(cmd, args, { stdio: 'ignore', cwd: OCR_DIR });
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timeout')); }, 8000);
      child.on('error', reject);
      child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('exit ' + code)); });
    });
    res.json({ enabled: true, available: true, model: 'Tesseract OCR' });
  } catch {
    res.json({ enabled: true, available: false, model: 'Tesseract OCR' });
  }
});

router.post('/ai-import', async (req, res) => {
  if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Only teachers can import score sheets.' });
  const enabled = String(process.env.AI_SCORE_IMPORT_ENABLED || 'true').toLowerCase() !== 'false';
  if (!enabled) return res.status(503).json({ error: 'Score-sheet import is disabled. Use manual score entry.' });
  const assignmentId = Number(req.body?.assignment_id);
  const termId = Number(req.body?.term_id);
  const image = String(req.body?.image || '');
  if (!Number.isInteger(assignmentId) || assignmentId < 1) return res.status(400).json({ error: 'Select a valid teaching assignment.' });
  if (!Number.isInteger(termId) || termId < 1) return res.status(400).json({ error: 'Select an unlocked academic term.' });
  const imageMatch = image.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!imageMatch) return res.status(400).json({ error: 'Upload a JPG, PNG or WebP score-sheet image.' });
  if (image.length > 10 * 1024 * 1024) return res.status(413).json({ error: 'Score-sheet image is too large. Use an image under 7 MB.' });

  const teacher = await teacherIdForUser(req.user.id);
  if (!teacher) return res.status(404).json({ error: 'Teacher record not found.' });

  let tmpPath = null;
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

    const roster = Object.fromEntries(students.map(s => [s.user_code, s.full_name]));
    const ext = imageMatch[1] === 'jpg' ? 'jpeg' : imageMatch[1];
    tmpPath = path.join(os.tmpdir(), `nnss-ocr-${crypto.randomUUID()}.${ext}`);
    await fs.writeFile(tmpPath, Buffer.from(imageMatch[2], 'base64'));

    const ocrResult = await runOcr(tmpPath, roster);
    const known = new Map(students.map(x => [x.user_code, { ...x }]));
    const rows = (ocrResult.rows || [])
      .map(r => ({
        user_code: String(r.user_code || '').trim().toUpperCase(),
        full_name: known.get(String(r.user_code || '').trim().toUpperCase())?.full_name || null,
        ca_score: r.ca_score === null || r.ca_score === undefined ? null : Number(r.ca_score),
        exam_score: r.exam_score === null || r.exam_score === undefined ? null : Number(r.exam_score),
        confidence: Number(r.confidence || 0),
        note: ''
      }))
      .filter(r => known.has(r.user_code))
      .map(r => ({ ...r, valid_ca: Number.isFinite(r.ca_score) && r.ca_score >= 0 && r.ca_score <= 30, valid_exam: Number.isFinite(r.exam_score) && r.exam_score >= 0 && r.exam_score <= 70 }));

    res.json({ assignment: { id: assignment.id, class_name: assignment.class_name, arm_name: assignment.arm_name, subject_name: assignment.subject_name }, term_id: term.id, term_name: term.term_name, rows, roster_count: students.length, extracted_count: rows.length, model: 'Tesseract OCR' });
  } catch (err) {
    if (err.message && !err.message.includes('\n') && err.message.length < 200) {
      // A clean, user-safe message we raised deliberately (from runOcr or a validation check above).
      res.status(503).json({ error: err.message });
    } else {
      console.error('[results/ai-import]', err);
      res.status(503).json({ error: 'Score-sheet import is unavailable right now. Use manual score entry.' });
    }
  } finally {
    if (tmpPath) { try { await fs.unlink(tmpPath); } catch {} }
  }
});

router.get('/pending', async (req, res) => {
  if (!['hod','admin','commandant'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden.' });
  try {
    let deptFilter = '';
    const params = [];
    // Scope by the SUBJECT's department, not the teacher's. A teacher may be
    // attached to one department but teach a subject owned by another; the HOD
    // who owns the subject is the one who should approve it. This also keeps
    // the queue consistent with the count shown on the HOD dashboard, which is
    // calculated from the subject's department.
    if (req.user.role === 'hod') { deptFilter = 'AND sub.dept_id = (SELECT dept_id FROM hods WHERE user_id=?)'; params.push(req.user.id); }
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
    const [[row]] = await conn.query(`SELECT r.id,r.is_approved,t.result_locked,sub.dept_id FROM results r JOIN terms t ON t.id=r.term_id JOIN subjects sub ON sub.id=r.subject_id WHERE r.id=? LIMIT 1`, [resultId]);
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
