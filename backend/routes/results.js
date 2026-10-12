const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { spawn } = require('child_process');
const db = require('../db');
const auth = require('../middleware/auth');
const scheme = require('../scheme');
const sheets = require('../sheets');
const sheetExcel = require('../sheetExcel');
const { routeLimiter } = require('../middleware/security');
const router = express.Router();
router.use(routeLimiter(300, 'Too many result requests. Please try again later.'));
router.use(auth);
// Free-text notes (approval / rejection reasons) are stored as-is, so bound them.
const NOTE_MAX = 500;
const cleanNote = raw => (typeof raw === 'string' ? raw.trim().slice(0, NOTE_MAX) : '');

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

// SECURITY FIX: OCR (Tesseract, now with multiple preprocessing/PSM passes)
// is genuinely CPU-expensive, and this route had no rate limiting at all —
// unlike /auth/login, any authenticated teacher account (or a buggy client
// stuck retrying) could fire off requests back-to-back and tie up the
// server for everyone, including on the modest hardware this app is meant
// to run on. Keyed by user ID since this route is already authenticated.
const OCR_RATE_WINDOW_MS = 5 * 60 * 1000;
const OCR_RATE_MAX = 6;
const OCR_RATE_MAX_ENTRIES = 5000;
const OCR_IMAGE_EXTENSIONS = Object.freeze({ jpeg: 'jpeg', jpg: 'jpeg', png: 'png', webp: 'webp' });
const ocrAttempts = new Map();
function cleanupOcrAttempts(now = Date.now()) {
  for (const [key, entry] of ocrAttempts) if (now >= entry.resetAt) ocrAttempts.delete(key);
}
function ocrRateLimit(req, res, next) {
  const now = Date.now();
  if (ocrAttempts.size >= OCR_RATE_MAX_ENTRIES) cleanupOcrAttempts(now);
  const key = String(req.user.id);
  const entry = ocrAttempts.get(key);
  if (!entry || now >= entry.resetAt) { ocrAttempts.set(key, { count: 1, resetAt: now + OCR_RATE_WINDOW_MS }); return next(); }
  entry.count += 1;
  if (entry.count > OCR_RATE_MAX) return res.status(429).json({ error: 'Too many scans in a short time. Please wait a few minutes and try again.' });
  next();
}
const ocrCleanupTimer = setInterval(() => cleanupOcrAttempts(), OCR_RATE_WINDOW_MS);
ocrCleanupTimer.unref();

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
    let stdoutBytes = 0, stderrBytes = 0, outputExceeded = false;
    const MAX_STDOUT_BYTES = 2 * 1024 * 1024;
    const MAX_STDERR_BYTES = 256 * 1024;
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('OCR timed out. Try a clearer, more evenly-lit photo.')); }, OCR_TIMEOUT_MS);
    child.stdout.on('data', d => {
      stdoutBytes += d.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        outputExceeded = true;
        child.kill('SIGKILL');
        return;
      }
      stdout += d;
    });
    child.stderr.on('data', d => {
      stderrBytes += d.length;
      // Keep only a small diagnostic tail; subprocess stderr is not trusted.
      if (stderr.length < MAX_STDERR_BYTES) stderr += d.toString('utf8').slice(0, MAX_STDERR_BYTES - stderr.length);
    });
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
      if (outputExceeded) return reject(new Error('OCR produced an oversized response. Use a smaller image or manual entry.'));
      // OCR stdout is the only trusted protocol channel. Never parse stderr:
      // it may contain environment details, logs, or private roster data.
      let parsed;
      try { parsed = JSON.parse(stdout.trim().split('\n').pop()); }
      catch {
        console.error('[ocr] unparseable output', { code, stdoutBytes, stderrBytes });
        return reject(new Error('OCR returned an unreadable response. Try again or use manual entry.'));
      }
      if (parsed.error) return reject(new Error(parsed.error));
      if (code !== 0) return reject(new Error('OCR process failed. Try again or use manual entry.'));
      resolve(parsed);
    });
    child.stdin.write(JSON.stringify({ roster, limits: { ...Object.fromEntries(scheme.COMPONENTS.map(c => [c.key, c.max])), exam: scheme.EXAM_MAX } }));
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
    const [rows] = await db.query(`SELECT tca.id,tca.teacher_id,tca.subject_id,s.subject_name,s.ca_max,s.exam_max,tca.class_level_id,cl.level_name AS class_name,tca.arm_id,a.arm_name,
      tca.session_id,ac.session_name FROM teacher_class_assignments tca JOIN subjects s ON s.id=tca.subject_id JOIN class_levels cl ON cl.id=tca.class_level_id
      JOIN arms a ON a.id=tca.arm_id JOIN academic_sessions ac ON ac.id=tca.session_id
      WHERE s.is_active=1 AND (? IS NULL OR tca.teacher_id=?) ORDER BY ac.start_date DESC,cl.id,a.arm_name,s.subject_name`, [teacher?.id ?? null, teacher?.id ?? null]);
    res.json(rows);
  } catch (err) { console.error('[results/assignments]', err); res.status(500).json({ error: 'Unable to load teaching assignments.' }); }
});

// ---------------------------------------------------------------------------
// Continuous Assessment Sheet
//
// A "sheet" is one subject for one class + arm in one term - exactly the paper
// sheet the school already uses. Teachers fill it in as a grid, HODs approve it,
// the Commandant monitors it, students see it on their report card.
// ---------------------------------------------------------------------------
const sendError = (res, e) => res.status(e.status).json({ error: e.message, ...(e.row_errors ? { row_errors: e.row_errors } : {}) });
const safeFile = v => String(v || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

router.get('/scheme', (req, res) => res.json(scheme.describe()));

// All sheets in a term with their progress (HOD: own department only).
router.get('/sheets', async (req, res) => {
  if (!['hod', 'admin', 'commandant'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden.' });
  try {
    const termId = Number(req.query.term_id);
    if (!Number.isInteger(termId) || termId < 1) return res.status(400).json({ error: 'Select an academic term.' });
    let deptId = null;
    if (req.user.role === 'hod') {
      const hod = await sheets.hodRecord(req.user.id);
      if (!hod) return res.status(404).json({ error: 'No department is assigned to your account.' });
      deptId = hod.dept_id;
    }
    const out = await sheets.sheetIndex(termId, { deptId });
    if (!out) return res.status(404).json({ error: 'Academic term not found.' });
    res.json(out);
  } catch (err) { console.error('[results/sheets]', err); res.status(500).json({ error: 'Unable to load result sheets.' }); }
});

router.get('/sheet', async (req, res) => {
  try {
    const { ctx, error } = await sheets.resolveSheetContext(req.user, req.query);
    if (error) return sendError(res, error);
    res.json(await sheets.loadSheet(ctx));
  } catch (err) { console.error('[results/sheet]', err); res.status(500).json({ error: 'Unable to load the score sheet.' }); }
});

// Save a whole class sheet (teacher only).
router.post('/sheet', async (req, res) => {
  if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Only teachers can submit score sheets.' });
  try {
    const { ctx, error } = await sheets.resolveSheetContext(req.user, req.body || {});
    if (error) return sendError(res, error);
    const out = await sheets.saveSheetRows(ctx, req.user, req.body?.rows);
    if (out.error) return sendError(res, out.error);
    const parts = [];
    if (out.saved) parts.push(`${out.saved} score${out.saved === 1 ? '' : 's'} saved and sent for HOD approval`);
    if (out.unchanged) parts.push(`${out.unchanged} unchanged`);
    if (!parts.length) parts.push('Nothing to save - every row is blank or unchanged');
    res.json({ message: `${parts.join(', ')}.`, ...out });
  } catch (err) { console.error('[results/sheet/save]', err); res.status(500).json({ error: 'Unable to save the score sheet.' }); }
});

// Blank, reusable Excel template (no class needed).
router.get('/sheet/template', async (req, res) => {
  if (!['teacher', 'hod', 'admin', 'commandant'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden.' });
  try {
    const wb = await sheetExcel.buildWorkbook({});
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="NNSS-CA-Score-Sheet-Template.xlsx"');
    await wb.xlsx.write(res); res.end();
  } catch (err) { console.error('[results/sheet/template]', err); if (!res.headersSent) res.status(500).json({ error: 'Unable to build the template.' }); }
});

// Excel copy of one class sheet, roster and saved scores pre-filled.
router.get('/sheet/export', async (req, res) => {
  try {
    const { ctx, error } = await sheets.resolveSheetContext(req.user, req.query);
    if (error) return sendError(res, error);
    const sheet = await sheets.loadSheet(ctx);
    const h = sheet.header;
    const wb = await sheetExcel.buildWorkbook({
      header: { class_name: h.class_name, arm_name: h.arm_name, term_name: h.term_name, session_name: h.session_name, subject_name: h.subject_name },
      rows: sheet.students.map(s => ({ user_code: s.user_code, full_name: s.full_name, scores: s.scores }))
    });
    const name = [h.class_name, h.arm_name, h.subject_name, h.term_name, h.session_name].map(safeFile).filter(Boolean).join('-');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name || 'score-sheet'}.xlsx"`);
    await wb.xlsx.write(res); res.end();
  } catch (err) { console.error('[results/sheet/export]', err); if (!res.headersSent) res.status(500).json({ error: 'Unable to export the score sheet.' }); }
});

// Read a filled-in Excel sheet and match it to the roster. Nothing is saved:
// the browser loads the values into the grid so the teacher can review them.
router.post('/sheet/import', async (req, res) => {
  if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Only teachers can import score sheets.' });
  const file = String(req.body?.file || '');
  const m = file.match(/^(?:data:[^;]+;base64,)?([A-Za-z0-9+/=\s]+)$/);
  if (!m) return res.status(400).json({ error: 'Upload an Excel (.xlsx) score sheet.' });
  try {
    const { ctx, error } = await sheets.resolveSheetContext(req.user, req.body || {});
    if (error) return sendError(res, error);
    if (ctx.term.result_locked) return res.status(409).json({ error: 'This term is locked and cannot be edited.' });
    const buffer = Buffer.from(m[1], 'base64');
    if (buffer.length < 100 || buffer.length > 4 * 1024 * 1024) return res.status(413).json({ error: 'The Excel file is empty or larger than 4 MB.' });
    let parsed;
    try { parsed = await sheetExcel.parseWorkbook(buffer); }
    catch (e) { return res.status(422).json({ error: e.message || 'That file could not be read as an Excel score sheet.' }); }
    const roster = await sheets.loadRoster(db, ctx);
    const { matched, unmatched } = sheetExcel.matchToRoster(parsed.rows, roster);
    res.json({
      rows: matched.map(r => ({ user_code: r.user_code, full_name: r.full_name, scores: r.scores, problems: r.problems })),
      unmatched, warnings: parsed.warnings, roster_count: roster.length, imported_count: matched.length
    });
  } catch (err) { console.error('[results/sheet/import]', err); res.status(500).json({ error: 'Unable to import the score sheet.' }); }
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

router.post('/ai-import', ocrRateLimit, async (req, res) => {
  if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Only teachers can import score sheets.' });
  const enabled = String(process.env.AI_SCORE_IMPORT_ENABLED || 'true').toLowerCase() !== 'false';
  if (!enabled) return res.status(503).json({ error: 'Score-sheet import is disabled. Use manual score entry.' });
  const image = String(req.body?.image || '');
  const imageMatch = image.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!imageMatch) return res.status(400).json({ error: 'Upload a JPG, PNG or WebP score-sheet image.' });
  if (image.length > 10 * 1024 * 1024) return res.status(413).json({ error: 'Score-sheet image is too large. Use an image under 7 MB.' });

  let tmpDir = null;
  try {
    const { ctx, error } = await sheets.resolveSheetContext(req.user, req.body || {});
    if (error) return sendError(res, error);
    if (ctx.term.result_locked) return res.status(409).json({ error: 'This academic term is locked.' });
    const students = await sheets.loadRoster(db, ctx);
    if (!students.length) return res.status(409).json({ error: 'No active students were found for this class and arm.' });

    const roster = Object.fromEntries(students.map(s => [s.user_code, s.full_name]));
    // The extension comes from a fixed allow-list and the file lives in a private,
    // freshly created temp directory, so no request data ever reaches the path.
    const ext = OCR_IMAGE_EXTENSIONS[imageMatch[1]];
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nnss-ocr-'));
    const tmpPath = path.join(tmpDir, `scan.${ext}`);
    await fs.writeFile(tmpPath, Buffer.from(imageMatch[2], 'base64'), { mode: 0o600 });

    const ocrResult = await runOcr(tmpPath, roster);
    const known = new Set(students.map(x => x.user_code));
    const rows = (ocrResult.rows || [])
      .map(r => {
        const code = String(r.user_code || '').trim().toUpperCase();
        const parsed = scheme.parseScores(r.scores || {});
        // parseScores nulls anything out of range, so a misread digit can never
        // sneak past the grid as a valid mark - it is reported as unreadable.
        const out_of_range = Object.keys(r.scores || {}).filter(k => r.scores[k] !== null && r.scores[k] !== undefined && parsed.values[k] === null);
        return { user_code: code, full_name: roster[code] || null, scores: parsed.values, out_of_range, confidence: Number(r.confidence || 0), note: r.note || '' };
      })
      .filter(r => known.has(r.user_code));

    res.json({ term_id: ctx.term.id, rows, roster_count: students.length, extracted_count: rows.length, model: 'Tesseract OCR' });
  } catch (err) {
    if (err.message && !err.message.includes('\n') && err.message.length < 200) {
      // A clean, user-safe message we raised deliberately (from runOcr or a validation check above).
      res.status(503).json({ error: err.message });
    } else {
      console.error('[results/ai-import]', err);
      res.status(503).json({ error: 'Score-sheet import is unavailable right now. Use manual score entry.' });
    }
  } finally {
    if (tmpDir) { try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* temp dir already gone */ } }
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
    const [rows] = await db.query(`SELECT r.id,su.user_code AS student_code,su.full_name AS student_name,r.subject_id,sub.subject_name,s.class_level_id,cl.level_name AS class_name,s.arm_id,a.arm_name,
      r.term_id,t.term_name,ac.session_name,r.test1_score,r.quiz_score,r.assignment_score,r.test2_score,r.project_score,r.note_score,
      r.ca_score,r.exam_score,r.total_score,r.grade,r.remark,r.uploaded_at,tu.full_name AS teacher_name
      FROM results r JOIN students s ON s.id=r.student_id JOIN users su ON su.id=s.user_id JOIN subjects sub ON sub.id=r.subject_id JOIN teachers tch ON tch.id=r.teacher_id
      JOIN users tu ON tu.id=tch.user_id JOIN class_levels cl ON cl.id=s.class_level_id JOIN arms a ON a.id=s.arm_id JOIN terms t ON t.id=r.term_id JOIN academic_sessions ac ON ac.id=t.session_id
      WHERE r.is_approved=0 AND r.rejected_at IS NULL ${deptFilter} ORDER BY r.updated_at ASC`, params);
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
    await conn.query('UPDATE results SET is_approved=1,approved_by=?,approved_at=NOW(),rejected_at=NULL,rejected_by=NULL,rejection_note=NULL WHERE id=?', [req.user.id, resultId]);
    await conn.query('INSERT INTO result_approval_log(result_id,action,actor_id,note) VALUES (?,?,?,?)', [resultId,'approved',req.user.id,cleanNote(req.body?.note) || null]);
    await conn.commit();
    res.json({ message: 'Result approved.' });
  } catch (err) { await conn.rollback(); console.error('[results/approve]', err); res.status(500).json({ error: 'Unable to approve result.' }); }
  finally { conn.release(); }
});

// Approve every pending result on one class sheet in a single step - the
// natural unit of work now that results arrive as whole sheets. Anything the
// HOD has already disapproved stays disapproved until the teacher resubmits.
router.put('/approve-sheet', async (req, res) => {
  if (req.user.role !== 'hod') return res.status(403).json({ error: 'Only HODs can approve results.' });
  const { subject_id, class_level_id, arm_id, term_id } = Object.fromEntries(['subject_id', 'class_level_id', 'arm_id', 'term_id'].map(k => [k, Number(req.body?.[k])]));
  if (![subject_id, class_level_id, arm_id, term_id].every(n => Number.isInteger(n) && n > 0)) return res.status(400).json({ error: 'Select a valid sheet.' });
  const conn = await db.getConnection();
  try {
    const [[hod]] = await conn.query('SELECT dept_id FROM hods WHERE user_id=? LIMIT 1', [req.user.id]);
    const [[subject]] = await conn.query('SELECT dept_id FROM subjects WHERE id=? LIMIT 1', [subject_id]);
    const [[term]] = await conn.query('SELECT result_locked FROM terms WHERE id=? LIMIT 1', [term_id]);
    if (!hod || !subject || !term) return res.status(404).json({ error: 'Sheet or HOD record not found.' });
    if (subject.dept_id !== hod.dept_id) return res.status(403).json({ error: 'This sheet belongs to another department.' });
    if (term.result_locked) return res.status(409).json({ error: 'This term is locked.' });
    await conn.beginTransaction();
    const [ids] = await conn.query(`SELECT r.id FROM results r JOIN students s ON s.id=r.student_id
      WHERE r.subject_id=? AND r.term_id=? AND s.class_level_id=? AND s.arm_id=? AND r.is_approved=0 AND r.rejected_at IS NULL FOR UPDATE`,
      [subject_id, term_id, class_level_id, arm_id]);
    if (!ids.length) { await conn.rollback(); return res.json({ message: 'Nothing pending on this sheet.', approved: 0 }); }
    const idList = ids.map(r => r.id);
    await conn.query('UPDATE results SET is_approved=1, approved_by=?, approved_at=NOW(), rejected_at=NULL, rejected_by=NULL, rejection_note=NULL WHERE id IN (?)', [req.user.id, idList]);
    await conn.query('INSERT INTO result_approval_log (result_id, action, actor_id, note) VALUES ?', [idList.map(id => [id, 'approved', req.user.id, cleanNote(req.body?.note) || 'Approved with the whole class sheet'])]);
    await conn.commit();
    res.json({ message: `${idList.length} result${idList.length === 1 ? '' : 's'} approved.`, approved: idList.length });
  } catch (err) { try { await conn.rollback(); } catch { /* nothing to roll back */ } console.error('[results/approve-sheet]', err); res.status(500).json({ error: 'Unable to approve this sheet.' }); }
  finally { conn.release(); }
});

// The schema always had a 'rejected' action in result_approval_log, but
// nothing ever wrote or read it — HODs could only approve, never send a
// result back for correction. This mirrors /approve but requires a reason
// (the teacher and student both need to know *why*), and takes the result
// out of the pending queue until the teacher resubmits corrected scores
// (POST /upload already clears these same three columns on resubmission).
router.put('/reject/:resultId', async (req, res) => {
  if (req.user.role !== 'hod') return res.status(403).json({ error: 'Only HODs can disapprove results.' });
  const resultId = Number(req.params.resultId);
  const note = cleanNote(req.body?.note);
  if (!Number.isInteger(resultId)) return res.status(400).json({ error: 'Invalid result ID.' });
  if (!note) return res.status(400).json({ error: 'A reason is required so the teacher knows what to correct.' });
  const conn = await db.getConnection();
  try {
    const [[row]] = await conn.query(`SELECT r.id,r.is_approved,t.result_locked,sub.dept_id FROM results r JOIN terms t ON t.id=r.term_id JOIN subjects sub ON sub.id=r.subject_id WHERE r.id=? LIMIT 1`, [resultId]);
    const [[hod]] = await conn.query('SELECT dept_id FROM hods WHERE user_id=? LIMIT 1', [req.user.id]);
    if (!row || !hod) return res.status(404).json({ error: 'Result or HOD record not found.' });
    if (row.dept_id !== hod.dept_id) return res.status(403).json({ error: 'This result belongs to another department.' });
    if (row.result_locked) return res.status(409).json({ error: 'This term is locked.' });
    if (row.is_approved) return res.status(409).json({ error: 'This result is already approved. Nothing to disapprove.' });
    await conn.beginTransaction();
    await conn.query('UPDATE results SET rejected_at=NOW(),rejected_by=?,rejection_note=? WHERE id=?', [req.user.id, note, resultId]);
    await conn.query('INSERT INTO result_approval_log(result_id,action,actor_id,note) VALUES (?,?,?,?)', [resultId,'rejected',req.user.id,note]);
    await conn.commit();
    res.json({ message: 'Result sent back to the teacher for correction.' });
  } catch (err) { await conn.rollback(); console.error('[results/reject]', err); res.status(500).json({ error: 'Unable to disapprove result.' }); }
  finally { conn.release(); }
});

// One rejected-results feed, scoped by role: a teacher sees results they
// submitted that got sent back; a student sees their own. Both need the
// same three facts — subject, term, and why — so one endpoint covers both.
router.get('/rejections', async (req, res) => {
  try {
    if (req.user.role === 'teacher') {
      const [rows] = await db.query(`SELECT r.id,su.full_name AS student_name,su.user_code AS student_code,sub.subject_name,
        t.term_name,ac.session_name,r.rejection_note,r.rejected_at,ru.full_name AS rejected_by_name
        FROM results r JOIN teachers tch ON tch.id=r.teacher_id JOIN students s ON s.id=r.student_id JOIN users su ON su.id=s.user_id
        JOIN subjects sub ON sub.id=r.subject_id JOIN terms t ON t.id=r.term_id JOIN academic_sessions ac ON ac.id=t.session_id
        LEFT JOIN users ru ON ru.id=r.rejected_by
        WHERE tch.user_id=? AND r.rejected_at IS NOT NULL ORDER BY r.rejected_at DESC`, [req.user.id]);
      return res.json(rows);
    }
    if (req.user.role === 'student') {
      const [rows] = await db.query(`SELECT r.id,sub.subject_name,t.term_name,ac.session_name,r.rejected_at
        FROM results r JOIN students s ON s.id=r.student_id JOIN users u ON u.id=s.user_id
        JOIN subjects sub ON sub.id=r.subject_id JOIN terms t ON t.id=r.term_id JOIN academic_sessions ac ON ac.id=t.session_id
        WHERE u.id=? AND r.rejected_at IS NOT NULL ORDER BY r.rejected_at DESC`, [req.user.id]);
      return res.json(rows);
    }
    res.status(403).json({ error: 'Forbidden.' });
  } catch (err) { console.error('[results/rejections]', err); res.status(500).json({ error: 'Unable to load rejected results.' }); }
});

router.get('/student/:studentCode', async (req, res) => {
  const studentCode = String(req.params.studentCode || '').trim().toUpperCase();
  const role = req.user.role;
  if (role === 'student' && req.user.user_code !== studentCode) return res.status(403).json({ error: 'You can only view your own results.' });
  try {
    // SECURITY FIX: any authenticated teacher or HOD could previously pull a
    // *named* student's full result history (approved and pending both) by
    // just changing the code in the URL — student codes are short and
    // sequential (STU0001, STU0002...), so this was trivially enumerable
    // school-wide, across every department and class, not just the ones a
    // given teacher/HOD actually has a relationship to. A teacher is now
    // scoped to students in a class/arm they are currently assigned to
    // teach; an HOD is scoped to their own department's subjects only —
    // matching the isolation already enforced everywhere else in the app
    // (the approval queue, department stats, etc.). Admin/commandant are
    // unrestricted, as they are for every other school-wide view.
    let canSeePending = ['admin', 'commandant'].includes(role);
    let extraWhere = '';
    const extraParams = [];
    if (role === 'teacher') {
      extraWhere = `AND EXISTS (SELECT 1 FROM teacher_class_assignments tca JOIN teachers tc ON tc.id=tca.teacher_id
        WHERE tc.user_id=? AND tca.subject_id=r.subject_id AND tca.class_level_id=s.class_level_id
          AND tca.arm_id=s.arm_id AND tca.session_id=ac.id AND ac.is_current=1)`;
      extraParams.push(req.user.id);
      canSeePending = true;
    }
    if (role === 'hod') {
      extraWhere = `AND sub.dept_id=(SELECT dept_id FROM hods WHERE user_id=?)`;
      extraParams.push(req.user.id);
      canSeePending = true;
    }
    const [rows] = await db.query(`SELECT r.id,sub.subject_name,t.term_name,t.term_number,ac.session_name,r.test1_score,r.quiz_score,r.assignment_score,r.test2_score,r.project_score,r.note_score,r.ca_score,r.exam_score,r.total_score,r.grade,r.remark,r.is_approved,r.uploaded_at,r.approved_at
      FROM results r JOIN subjects sub ON sub.id=r.subject_id JOIN terms t ON t.id=r.term_id JOIN academic_sessions ac ON ac.id=t.session_id JOIN students s ON s.id=r.student_id JOIN users u ON u.id=s.user_id
      WHERE u.user_code=? AND (r.is_approved=1 OR ?) ${extraWhere} ORDER BY ac.start_date DESC,t.term_number DESC,sub.subject_name`, [studentCode, canSeePending ? 1 : 0, ...extraParams]);
    res.json(rows);
  } catch (err) { console.error('[results/student]', err); res.status(500).json({ error: 'Unable to load results.' }); }
});

module.exports = router;
