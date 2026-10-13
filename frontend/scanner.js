// NNSS Calabar - teacher score entry screens.
//
//   * Manual Entry : one student at a time, all seven columns of the CA sheet,
//                    live total + grade, saved straight to the HOD's approval queue.
//   * AI Scanner   : photograph (or upload) the paper Continuous Assessment Sheet,
//                    let OCR read it, then REVIEW every student's marks in a table
//                    and confirm before anything is submitted for many students at once.
//
// Nothing the scanner reads is saved until the teacher ticks the confirmation box and
// presses submit; rows can be corrected, re-assigned to another student, removed, or
// added. Both screens save through the same endpoint as the full Score Sheet grid, so
// the same validation, approval rules and audit trail apply.
import { getScheme, getSheet, saveSheet, getAiStatus, aiImportScores } from './api.js';

let C = null;
let scheme = null;
const manual = { params: null, sheet: null };
const scan = { params: null, roster: [], rows: [], file: null, aiAvailable: null, pdf: false, busy: false };

export function init(ctx) { C = ctx; }
export async function loadScheme() { if (!scheme) scheme = await getScheme(); return scheme; }

const $ = s => document.querySelector(s);
const FIELDS = () => [...scheme.components.map(c => c.key), 'exam'];
const maxOf = key => (key === 'exam' ? scheme.exam_max : scheme.components.find(c => c.key === key).max);
const labelOf = key => (key === 'exam' ? 'Exam' : scheme.components.find(c => c.key === key).label);
const r2 = n => Math.round(n * 100) / 100;
const gradeOf = total => scheme.grade_scale.find(g => total >= g.min) || scheme.grade_scale[scheme.grade_scale.length - 1];
const fmt = v => (v === null || v === undefined || v === '' ? '' : String(v));
const STATE_LABEL = { none: 'not entered', pending: 'awaiting HOD', approved: 'approved', rejected: 'sent back' };

// Marks typed in the browser are strings. null = not a usable number (blank / out of range).
function parseField(raw, key) {
  const t = String(raw ?? '').trim();
  if (t === '') return { blank: true, value: null, ok: false };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > maxOf(key)) return { blank: false, value: null, ok: false };
  return { blank: false, value: r2(n), ok: true };
}
function summarise(values) {
  const parsed = FIELDS().map(k => ({ key: k, ...parseField(values[k], k) }));
  const filled = parsed.filter(p => !p.blank).length;
  const bad = parsed.filter(p => !p.blank && !p.ok).map(p => p.key);
  const missing = parsed.filter(p => p.blank).map(p => p.key);
  const total = r2(parsed.reduce((a, p) => a + (p.value || 0), 0));
  return { parsed, filled, bad, missing, total, complete: filled === parsed.length && !bad.length };
}

// ------------------------------------------------------------------ shared picker
function picker(prefix, openLabel) {
  const a = C.state.assignments || [];
  const terms = C.state.meta?.terms || [];
  const aOpts = a.map(x => `<option value="${x.id}" data-session="${x.session_id}">${C.esc(x.class_name)} ${C.esc(x.arm_name)} — ${C.esc(x.subject_name)} (${C.esc(x.session_name)})</option>`).join('');
  const tOpts = terms.map(t => `<option value="${t.id}" data-session="${t.session_id}" data-locked="${t.result_locked ? 1 : 0}" ${t.is_current ? 'selected' : ''}>${C.esc(t.session_name)} — ${C.esc(t.term_name)}${t.result_locked ? ' (locked)' : ''}</option>`).join('');
  if (!a.length) return C.card('1. Choose class and subject', '<div class="portal-empty"><h3>No teaching assignments yet</h3><p>Ask your HOD or an administrator to assign you a class and subject first.</p></div>');
  return C.card('1. Choose class and subject', `<div class="portal-form-grid">
      <div class="form-group full"><label for="${prefix}Assignment">Class, arm and subject</label><select id="${prefix}Assignment"><option value="">Select…</option>${aOpts}</select></div>
      <div class="form-group"><label for="${prefix}Term">Term</label><select id="${prefix}Term">${tOpts}</select></div>
      ${openLabel ? `<div class="form-group" style="align-self:end"><button class="btn btn-primary" id="${prefix}Open">${C.esc(openLabel)}</button></div>` : ''}
    </div>`);
}
function bindPicker(prefix) {
  const aSel = $(`#${prefix}Assignment`), tSel = $(`#${prefix}Term`);
  if (!aSel) return;
  const sync = () => {
    const sid = aSel.selectedOptions[0]?.dataset.session;
    [...tSel.options].forEach(o => { o.hidden = !!sid && o.dataset.session !== sid; o.disabled = o.hidden || o.dataset.locked === '1'; });
    if (tSel.selectedOptions[0]?.disabled) { const ok = [...tSel.options].find(o => !o.disabled); if (ok) tSel.value = ok.value; }
  };
  aSel.addEventListener('change', sync);
  if (C.state.assignments?.length === 1) aSel.value = String(C.state.assignments[0].id);
  sync();
}
function pickedParams(prefix) {
  const a = $(`#${prefix}Assignment`)?.value, t = $(`#${prefix}Term`)?.value;
  if (!a || !t) { C.toast('Choose a class/subject and a term first.', 'error'); return null; }
  if ($(`#${prefix}Term`).selectedOptions[0]?.disabled) { C.toast('That term is locked. Ask an administrator to unlock it.', 'error'); return null; }
  return { assignment_id: Number(a), term_id: Number(t) };
}

// ------------------------------------------------------------ live total / grade
const gradeBadge = total => { const g = gradeOf(total); return `<span class="${C.gradeClass(g.grade)}">${C.esc(g.grade)}</span>`; };
function scoreInputs(prefix, values, extraCls = '') {
  return scheme.components.concat([{ key: 'exam', label: 'Exam', max: scheme.exam_max }]).map(c =>
    `<div class="form-group"><label for="${prefix}-${c.key}">${C.esc(c.label)} <small>(0–${c.max})</small></label><input id="${prefix}-${c.key}" class="${extraCls}" type="number" inputmode="decimal" min="0" max="${c.max}" step="0.5" data-key="${c.key}" value="${C.esc(fmt(values[c.key]))}"></div>`).join('');
}

// =========================================================== MANUAL ENTRY
export function renderManual() {
  return `<div class="portal-toolbar"><div><div class="eyebrow">Teacher workflow</div><h1>Manual Entry</h1><p>Enter one student's marks at a time. Saved marks go to your HOD for approval.</p></div><button class="btn btn-secondary btn-auto" data-go="sheet">${C.ic('document', 16)} Full class sheet</button></div>
    ${picker('man', 'Open class list')}<div id="manArea"></div>`;
}
export function bindManual() {
  bindPicker('man');
  $('#manOpen')?.addEventListener('click', async () => {
    const params = pickedParams('man'); if (!params) return;
    const area = $('#manArea');
    area.innerHTML = '<div class="portal-loading"><span class="loading"></span><p>Opening the class list…</p></div>';
    try {
      await loadScheme();
      manual.params = params; manual.sheet = await getSheet(params);
      drawManual(null);
    } catch (e) { area.innerHTML = `<div class="portal-card"><div class="portal-empty"><h3>Could not open this class</h3><p>${C.esc(e.message)}</p></div></div>`; }
  });
}

function drawManual(selectCode) {
  const area = $('#manArea'), sheet = manual.sheet;
  if (!sheet.can_edit) { area.innerHTML = `<div class="ai-review-note ai-review-warn">${sheet.locked ? 'This term is locked, so scores cannot be changed.' : 'You cannot edit this sheet.'}</div>`; return; }
  if (!sheet.students.length) { area.innerHTML = '<div class="portal-card"><div class="portal-empty"><h3>No students in this class</h3><p>No active students are registered in this class and arm yet.</p></div></div>'; return; }
  const h = sheet.header;
  const options = sheet.students.map(s => `<option value="${C.esc(s.user_code)}" ${s.user_code === selectCode ? 'selected' : ''}>${C.esc(s.full_name)} (${C.esc(s.user_code)}) — ${STATE_LABEL[s.state]}</option>`).join('');
  const done = sheet.students.filter(s => s.state !== 'none').length;
  area.innerHTML = C.card(`2. Enter marks — ${C.esc(h.class_name)} ${C.esc(h.arm_name)} · ${C.esc(h.subject_name)} · ${C.esc(h.term_name)}`, `
    <div class="sheet-statusline"><span class="portal-badge ok">${done} of ${sheet.students.length} entered</span></div>
    <div class="form-group"><label for="manStudent">Student</label><select id="manStudent"><option value="">Select student…</option>${options}</select></div>
    <div id="manNote"></div>
    <div class="portal-form-grid" id="manFields" hidden>${scoreInputs('man', {})}</div>
    <div class="sheet-summary" id="manLive" hidden></div>
    <div class="portal-actions" id="manActions" hidden>
      <button class="btn btn-primary" id="manSave">Save &amp; submit to HOD</button>
      <button class="btn btn-secondary" id="manSaveNext">Save &amp; next student</button>
      <button class="btn btn-secondary" id="manClear">Clear</button>
    </div>`);
  const sel = $('#manStudent');
  sel.onchange = () => loadManualStudent(sel.value);
  $('#manFields').addEventListener('input', updateManualLive);
  $('#manClear').onclick = () => { $('#manFields').querySelectorAll('input').forEach(i => { i.value = ''; }); updateManualLive(); };
  $('#manSave').onclick = () => saveManual(false);
  $('#manSaveNext').onclick = () => saveManual(true);
  if (selectCode) loadManualStudent(selectCode);
}

function loadManualStudent(code) {
  const s = manual.sheet.students.find(x => x.user_code === code);
  const show = !!s;
  ['manFields', 'manLive', 'manActions'].forEach(id => { $('#' + id).hidden = !show; });
  const note = $('#manNote'); note.innerHTML = '';
  if (!s) return;
  $('#manFields').querySelectorAll('input').forEach(i => { i.value = fmt(s.scores[i.dataset.key]); });
  if (s.legacy_ca) note.innerHTML = `<div class="ai-review-note ai-review-warn">An earlier entry recorded only a CA total of ${C.esc(s.ca_total)}. Enter every column below to replace it.</div>`;
  else if (s.state === 'approved') note.innerHTML = '<div class="ai-review-note ai-review-warn">This result is already approved. Changing it sends it back to your HOD for approval again.</div>';
  else if (s.state === 'rejected') note.innerHTML = `<div class="ai-review-note ai-review-warn"><strong>Sent back by your HOD:</strong> ${C.esc(s.rejection_note || 'please correct and resubmit.')}</div>`;
  updateManualLive();
}

function manualValues() { const v = {}; $('#manFields').querySelectorAll('input').forEach(i => { v[i.dataset.key] = i.value; }); return v; }
function updateManualLive() {
  const vals = manualValues(), sm = summarise(vals);
  $('#manFields').querySelectorAll('input').forEach(i => i.classList.toggle('bad', sm.bad.includes(i.dataset.key)));
  const live = $('#manLive');
  if (sm.filled === 0) { live.innerHTML = ''; return; }
  live.innerHTML = `<span>1st CA <strong>${r2(sm.parsed.filter(p => scheme.components.find(c => c.key === p.key && c.group === 'ca1')).reduce((a, p) => a + (p.value || 0), 0))}</strong>/${scheme.groups.ca1.max}</span><span>2nd CA <strong>${r2(sm.parsed.filter(p => scheme.components.find(c => c.key === p.key && c.group === 'ca2')).reduce((a, p) => a + (p.value || 0), 0))}</strong>/${scheme.groups.ca2.max}</span><span>Term's total <strong>${sm.total}</strong>/${scheme.total_max}</span><span>Grade <strong>${sm.complete ? gradeBadge(sm.total) : '—'}</strong></span>${sm.complete ? '' : `<span class="sheet-warn">${sm.bad.length ? `Out of range: ${sm.bad.map(labelOf).join(', ')}` : `Still needed: ${sm.missing.map(labelOf).join(', ')}`}</span>`}`;
}

async function saveManual(goNext) {
  const code = $('#manStudent').value;
  if (!code) return C.toast('Select a student first.', 'error');
  const vals = manualValues(), sm = summarise(vals);
  if (sm.bad.length) return C.toast(`Fix these marks first: ${sm.bad.map(labelOf).join(', ')} (each must be a number within its limit).`, 'error');
  if (sm.missing.length) return C.toast(`Fill every column — enter 0 if the student scored nothing. Missing: ${sm.missing.map(labelOf).join(', ')}.`, 'error');
  const btns = ['manSave', 'manSaveNext'].map(id => $('#' + id));
  btns.forEach(b => { b.disabled = true; });
  try {
    const row = { student_code: code }; sm.parsed.forEach(p => { row[p.key] = p.value; });
    const out = await saveSheet({ ...manual.params, rows: [row] });
    C.toast(out.saved ? 'Saved and sent to your HOD for approval.' : 'No change — these marks were already saved.', 'success');
    manual.sheet = await getSheet(manual.params);
    let next = code;
    if (goNext) { const i = manual.sheet.students.findIndex(s => s.user_code === code); next = (manual.sheet.students.slice(i + 1).find(s => s.state === 'none') || manual.sheet.students.find(s => s.state === 'none') || {}).user_code || null; if (!next) C.toast('Every student in this class has now been entered.', 'success'); }
    drawManual(next);
  } catch (e) {
    const detail = e.data?.row_errors?.[0]?.messages?.join(' ');
    C.toast(detail || e.message, 'error');
    btns.forEach(b => { if (b) b.disabled = false; });
  }
}

// =========================================================== AI SCANNER
export function renderScanner() {
  return `<div class="portal-toolbar"><div><div class="eyebrow">Assisted data entry</div><h1>AI Score-Sheet Scanner</h1><p>Photograph or upload the paper Continuous Assessment Sheet, check what was read, then confirm to submit the whole class for HOD approval.</p></div><span id="scBadge" class="portal-badge pending">Checking OCR engine…</span></div>
    ${picker('sc')}
    ${C.card('2. Capture or upload the sheet', `<div class="ai-dropzone"><div class="ai-drop-icon">${C.ic('cpu', 20)}</div><h3>Score sheet</h3>
      <p>Use a clear, flat, well-lit photo with the whole table in frame (JPG, PNG or WebP<span id="scPdfHint"></span>). The file is read and discarded — it is not stored.</p>
      <div class="portal-actions"><label class="btn btn-primary" for="scFile">Choose photo / file<input id="scFile" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden></label><button class="btn btn-secondary" id="scAnalyze" disabled>Scan sheet</button></div>
      <small id="scFileName">No file selected</small></div>`)}
    <div id="scResults"></div>`;
}

export function bindScanner() {
  bindPicker('sc');
  scan.rows = []; scan.file = null;
  const badge = $('#scBadge'), analyze = $('#scAnalyze');
  const refresh = () => { analyze.disabled = !scan.file || scan.busy; };
  getAiStatus().then(s => {
    scan.aiAvailable = !!s.available; scan.pdf = !!s.pdf;
    badge.textContent = s.available ? 'Scanner ready' : 'OCR unavailable — use Manual Entry';
    badge.className = `portal-badge ${s.available ? 'ok' : 'pending'}`;
    const input = $('#scFile');
    if (input && s.pdf) { input.accept = 'image/jpeg,image/png,image/webp,application/pdf'; $('#scPdfHint').textContent = ' or PDF'; }
  }).catch(() => { scan.aiAvailable = false; badge.textContent = 'OCR unavailable — use Manual Entry'; });
  $('#scFile').onchange = e => {
    const f = e.target.files?.[0]; scan.file = f || null;
    $('#scFileName').textContent = f ? `${f.name} (${Math.round(f.size / 1024)} KB)` : 'No file selected';
    refresh();
  };
  analyze.onclick = runScan;
}

const readAsDataUrl = file => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });

// Phone photos are often 5-10 MB. Shrink big images in the browser so the upload is
// quick and always under the server's limit; the sheet is still very readable at 2600px.
async function prepareUpload(file) {
  if (file.type === 'application/pdf') return readAsDataUrl(file);
  if (file.size < 1.5 * 1024 * 1024 || typeof createImageBitmap !== 'function') return readAsDataUrl(file);
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  } catch { return readAsDataUrl(file); }
}

async function runScan() {
  const params = pickedParams('sc'); if (!params) return;
  if (!scan.file) return C.toast('Choose a photo of the score sheet first.', 'error');
  if (scan.aiAvailable === false) return C.toast('The scanner is not available on this server. Use Manual Entry or the Excel import on the Score Sheet.', 'error');
  const out = $('#scResults'), analyze = $('#scAnalyze');
  scan.busy = true; analyze.disabled = true;
  out.innerHTML = `<div class="portal-card"><div class="ai-progress"><div class="ai-progress-track"><div class="ai-progress-bar" id="scBar" style="width:5%">5%</div></div><p id="scStage">Preparing the file…</p></div></div>`;
  const stages = [[10, 'Uploading…'], [30, 'Correcting lighting and tilt…'], [60, 'Reading the score sheet…'], [85, 'Matching rows to the class roster…']];
  let i = 0;
  const timer = setInterval(() => { if (i < stages.length) { const [p, t] = stages[i++]; const bar = $('#scBar'); if (bar) { bar.style.width = p + '%'; bar.textContent = p + '%'; } const st = $('#scStage'); if (st) st.textContent = t; } }, 2500);
  try {
    await loadScheme();
    const [sheet, image] = await Promise.all([getSheet(params), prepareUpload(scan.file)]);
    if (!sheet.can_edit) throw new Error(sheet.locked ? 'This term is locked, so scores cannot be changed.' : 'You cannot edit this sheet.');
    const res = await aiImportScores({ ...params, image });
    scan.params = params; scan.roster = sheet.students; scan.rosterCount = sheet.students.length;
    scan.rows = res.rows.map(r => ({ user_code: r.user_code, confidence: r.confidence, note: r.note || '', scanned: true, out_of_range: r.out_of_range || [], values: Object.fromEntries(FIELDS().map(k => [k, fmt(r.scores?.[k])])) }));
    scan.submitted = null;
    drawReview();
    if (!scan.rows.length) C.toast('No student rows could be recognised. Retake the photo flat and in good light, or use Manual Entry.', 'error');
  } catch (e) {
    out.innerHTML = `<div class="portal-card"><div class="portal-empty"><h3>Scan could not be completed</h3><p>${C.esc(e.message)}</p><button class="btn btn-secondary" id="scManual" data-go="manual">Continue with manual entry</button></div></div>`;
    $('#scManual').onclick = () => C.render('manual');
  } finally { clearInterval(timer); scan.busy = false; analyze.disabled = !scan.file; }
}

// ------------------------------------------------------------ review table
function rowIssues(row, dupCodes) {
  const issues = [];
  if (!row.user_code) issues.push('Pick the student');
  else if (dupCodes.has(row.user_code)) issues.push('Duplicate — remove one');
  const sm = summarise(row.values);
  if (sm.bad.length) issues.push(`Out of range: ${sm.bad.map(labelOf).join(', ')}`);
  else if (sm.missing.length) issues.push(`Missing: ${sm.missing.map(labelOf).join(', ')} (type 0 if none)`);
  return issues;
}
function duplicateCodes() {
  const counts = {}; scan.rows.forEach(r => { if (r.user_code) counts[r.user_code] = (counts[r.user_code] || 0) + 1; });
  return new Set(Object.keys(counts).filter(k => counts[k] > 1));
}

function drawReview() {
  const out = $('#scResults');
  const dups = duplicateCodes();
  const studentOpts = code => `<option value="">— Select student —</option>${scan.roster.map(s => `<option value="${C.esc(s.user_code)}" ${s.user_code === code ? 'selected' : ''}>${C.esc(s.full_name)} (${C.esc(s.user_code)})</option>`).join('')}`;
  const comps = scheme.components.concat([{ key: 'exam', label: 'Exam', max: scheme.exam_max }]);
  const head = `<tr><th>#</th><th class="sheet-name-col">Student</th>${comps.map(c => `<th class="sheet-col">${C.esc(c.label)}<small>${c.max}</small></th>`).join('')}<th class="sheet-col">Total<small>${scheme.total_max}</small></th><th>Grade</th><th>Read</th><th></th></tr>`;
  const body = scan.rows.map((r, idx) => {
    const sm = summarise(r.values), issues = rowIssues(r, dups);
    const conf = r.confidence != null && r.scanned ? Math.round(r.confidence * 100) : null;
    const flagged = conf !== null && (conf < 85 || r.out_of_range.length || r.note);
    return `<tr data-idx="${idx}" class="${dups.has(r.user_code) ? 'ai-row-duplicate' : ''} ${issues.length ? 'row-error' : ''}">
      <td>${idx + 1}</td>
      <td class="sheet-name"><select class="ai-student-select" data-idx="${idx}">${studentOpts(r.user_code)}</select>${issues.length ? `<small class="ai-note ai-note-danger" data-issues>${C.esc(issues.join(' · '))}</small>` : '<small class="ai-note" data-issues></small>'}${r.note ? `<small class="ai-note">${C.esc(r.note)}</small>` : ''}</td>
      ${comps.map(c => `<td><input class="sheet-input ${r.scanned && r.values[c.key] !== '' ? 'scanned' : ''} ${summarise(r.values).bad.includes(c.key) || (r.scanned && r.out_of_range.includes(c.key)) ? 'bad' : ''}" type="number" inputmode="decimal" min="0" max="${c.max}" step="0.5" data-idx="${idx}" data-key="${c.key}" value="${C.esc(r.values[c.key])}"></td>`).join('')}
      <td class="sheet-calc sheet-total" data-total>${sm.filled ? sm.total : ''}</td>
      <td class="sheet-calc" data-grade>${sm.complete ? gradeBadge(sm.total) : ''}</td>
      <td><span class="portal-badge ${conf !== null && !flagged ? 'ok' : 'pending'}">${conf !== null ? conf + '%' : 'Manual'}</span></td>
      <td><button class="btn btn-secondary ai-remove-btn" data-remove="${idx}" title="Remove this row" aria-label="Remove row ${idx + 1}">${C.ic('x', 14)}</button></td></tr>`;
  }).join('');
  const missing = scan.roster.filter(s => !scan.rows.some(r => r.user_code === s.user_code));
  out.innerHTML = C.card('3. Check what was read', `
    <div class="ai-review-note"><strong>Nothing is submitted yet.</strong> The scanner can misread handwriting. Compare every tinted value with the paper sheet, correct anything wrong, pick the right student where a name was not matched, and remove duplicates. ${scan.rows.length} of ${scan.roster.length} students were read.</div>
    <div class="table-wrapper sheet-wrap"><table class="portal-table sheet-table"><thead>${head}</thead><tbody>${body || `<tr><td colspan="${comps.length + 6}"><div class="portal-empty">Nothing was read. Add rows below or use Manual Entry.</div></td></tr>`}</tbody></table></div>
    <div class="portal-actions"><button class="btn btn-secondary" id="scAddRow">${C.ic('plus', 15)} Add student row</button>${missing.length ? `<button class="btn btn-secondary" id="scAddMissing">Add the ${missing.length} student${missing.length === 1 ? '' : 's'} not read</button>` : ''}<button class="btn btn-secondary" id="scDiscard">Discard and rescan</button></div>
    <div id="scConfirmBox"></div>`);
  bindReview();
  updateConfirm();
}

function bindReview() {
  const out = $('#scResults');
  out.querySelectorAll('.ai-student-select').forEach(sel => { sel.onchange = () => { scan.rows[Number(sel.dataset.idx)].user_code = sel.value || null; drawReview(); }; });
  out.querySelectorAll('[data-remove]').forEach(b => { b.onclick = () => { scan.rows.splice(Number(b.dataset.remove), 1); drawReview(); }; });
  // Typing updates the row in place (no re-render) so focus is never lost mid-entry.
  out.querySelector('tbody').addEventListener('input', e => {
    const inp = e.target; if (!inp.classList.contains('sheet-input')) return;
    const idx = Number(inp.dataset.idx), row = scan.rows[idx];
    row.values[inp.dataset.key] = inp.value; inp.classList.remove('scanned');
    row.out_of_range = row.out_of_range.filter(k => k !== inp.dataset.key);
    const tr = inp.closest('tr'), sm = summarise(row.values);
    tr.querySelectorAll('.sheet-input').forEach(i => i.classList.toggle('bad', sm.bad.includes(i.dataset.key)));
    tr.querySelector('[data-total]').textContent = sm.filled ? sm.total : '';
    tr.querySelector('[data-grade]').innerHTML = sm.complete ? gradeBadge(sm.total) : '';
    const issues = rowIssues(row, duplicateCodes());
    tr.classList.toggle('row-error', issues.length > 0);
    const note = tr.querySelector('[data-issues]'); note.textContent = issues.join(' · '); note.classList.toggle('ai-note-danger', issues.length > 0);
    updateConfirm();
  });
  $('#scAddRow').onclick = () => { scan.rows.push({ user_code: null, confidence: null, note: '', scanned: false, out_of_range: [], values: Object.fromEntries(FIELDS().map(k => [k, ''])) }); drawReview(); };
  $('#scAddMissing')?.addEventListener('click', () => {
    scan.roster.filter(s => !scan.rows.some(r => r.user_code === s.user_code)).forEach(s => scan.rows.push({ user_code: s.user_code, confidence: null, note: '', scanned: false, out_of_range: [], values: Object.fromEntries(FIELDS().map(k => [k, ''])) }));
    drawReview();
  });
  $('#scDiscard').onclick = () => { scan.rows = []; $('#scResults').innerHTML = ''; };
}

function updateConfirm() {
  const box = $('#scConfirmBox'); if (!box) return;
  const dups = duplicateCodes();
  const problems = scan.rows.filter(r => rowIssues(r, dups).length).length;
  const byCode = new Map(scan.roster.map(s => [s.user_code, s]));
  // Rows that overwrite marks already saved for the student (and will go back to the HOD).
  const replacing = scan.rows.filter(r => { const s = byCode.get(r.user_code); if (!s || s.state === 'none') return false; const sm = summarise(r.values); return sm.complete && FIELDS().some(k => Number(s.scores[k]) !== sm.parsed.find(p => p.key === k).value); }).length;
  const ready = scan.rows.length - problems;
  const prevChecked = $('#scTick')?.checked || false;
  box.innerHTML = `<div class="sheet-summary"><span><strong>${ready}</strong> ready</span><span class="${problems ? 'sheet-warn' : ''}"><strong>${problems}</strong> need attention</span>${replacing ? `<span class="sheet-warn"><strong>${replacing}</strong> will replace marks already saved</span>` : ''}</div>
    <label class="ai-review-note" style="display:flex;gap:.6rem;align-items:flex-start;cursor:pointer"><input type="checkbox" id="scTick" ${prevChecked ? 'checked' : ''} style="margin-top:.2rem"><span>I have compared every row with the paper score sheet and the marks above are correct. I understand they will be sent to my HOD for approval${replacing ? ' and will replace marks already saved for those students' : ''}.</span></label>
    <div class="portal-actions"><button class="btn btn-primary" id="scSubmit" disabled>Confirm &amp; submit ${scan.rows.length} student${scan.rows.length === 1 ? '' : 's'}</button></div>`;
  const tick = $('#scTick'), btn = $('#scSubmit');
  const sync = () => { btn.disabled = !(tick.checked && scan.rows.length > 0 && problems === 0); };
  tick.onchange = sync; sync();
  btn.onclick = submitScan;
}

async function submitScan() {
  const btn = $('#scSubmit');
  const dups = duplicateCodes();
  if (scan.rows.some(r => rowIssues(r, dups).length)) return C.toast('Fix the rows marked in red first.', 'error');
  const rows = scan.rows.map(r => { const sm = summarise(r.values); const o = { student_code: r.user_code }; sm.parsed.forEach(p => { o[p.key] = p.value; }); return o; });
  btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    const res = await saveSheet({ ...scan.params, rows });
    $('#scResults').innerHTML = C.card('Submitted', `<div class="ai-review-note"><strong>${C.esc(res.message)}</strong></div><div class="portal-actions"><button class="btn btn-primary" id="scAgain">Scan another sheet</button><button class="btn btn-secondary" id="scToSheet" data-go="sheet">Open the class Score Sheet</button></div>`);
    $('#scAgain').onclick = () => C.render('scanner');
    $('#scToSheet').onclick = () => C.render('sheet');
    scan.rows = [];
    C.toast(res.message, 'success');
  } catch (e) {
    const errs = e.data?.row_errors || [];
    errs.forEach(re => { const idx = scan.rows.findIndex(r => r.user_code === re.student_code); if (idx >= 0) { const tr = document.querySelector(`tr[data-idx="${idx}"]`); if (tr) { tr.classList.add('row-error'); const n = tr.querySelector('[data-issues]'); if (n) { n.textContent = re.messages.join(' '); n.classList.add('ai-note-danger'); } } } });
    C.toast(e.message, 'error');
    const b = $('#scSubmit'); if (b) { b.disabled = false; b.textContent = `Confirm & submit ${scan.rows.length} students`; }
  }
}
