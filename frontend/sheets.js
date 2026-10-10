// NNSS Calabar - Continuous Assessment Sheet screens.
//
//   * Teacher  -> "Score Sheet": fill one subject for one class + arm + term as a
//                 grid that mirrors the paper sheet (live totals and grade),
//                 with draft autosave, Excel template / import, photo scan, print.
//   * HOD / Admin / Commandant -> "Result Sheets": progress of every sheet in a
//                 term, and a read-only copy of any one of them.
//
// portal.js hands us its helpers once through init(); everything else lives here.
import { getScheme, getSheet, saveSheet, importSheetFile, getSheetIndex, approveSheet, sheetDownloadUrl, getAiStatus, aiImportScores } from './api.js';

let C = null;                  // helpers from portal.js
let scheme = null;             // CA scheme served by the backend
const view = { sheet: null, params: null, snapshot: null, readOnly: false, termIndex: null, filters: { status: '', class_level_id: '', dept_id: '' }, termId: '', aiAvailable: null };

export function init(ctx) { C = ctx; }
export async function loadScheme() { if (!scheme) scheme = await getScheme(); return scheme; }

const $ = s => document.querySelector(s);
const FIELDS = () => [...scheme.components.map(c => c.key), 'exam'];
const maxOf = key => (key === 'exam' ? scheme.exam_max : scheme.components.find(c => c.key === key).max);
const gradeOf = total => (scheme.grade_scale.find(g => total >= g.min) || scheme.grade_scale[scheme.grade_scale.length - 1]);
const r2 = n => Math.round(n * 100) / 100;
const fmt = v => (v === null || v === undefined || v === '' ? '' : String(v));
const STATE_LABEL = { none: 'Not entered', pending: 'Awaiting HOD', approved: 'Approved', rejected: 'Sent back' };
const STATE_CLASS = { none: '', pending: 'pending', approved: 'ok', rejected: 'danger' };
const SHEET_STATUS = { not_started: ['Not started', 'danger'], in_progress: ['In progress', 'pending'], submitted: ['Awaiting approval', 'pending'], approved: ['Approved', 'ok'] };

function draftKey(p) { return `nnss_sheet_draft:${C.state.user.id}:${p.assignment_id || `${p.class_level_id}-${p.arm_id}-${p.subject_id}`}:${p.term_id}`; }
function readDraft(p) { try { return JSON.parse(localStorage.getItem(draftKey(p)) || 'null'); } catch { return null; } }
function writeDraft(p, data) { try { if (data && Object.keys(data).length) localStorage.setItem(draftKey(p), JSON.stringify(data)); else localStorage.removeItem(draftKey(p)); } catch { /* storage unavailable: drafts are a convenience only */ } }

// ---------------------------------------------------------------- grid markup
function headerBlock(h) {
  return `<div class="sheet-paper-head">
    <h2>${C.esc(h.school_name || scheme.school_name)}</h2>
    <h3>Continuous Assessment Sheet</h3>
    <div class="sheet-meta">
      <span>Subject: <strong>${C.esc(h.subject_name)}</strong></span>
      <span>Class: <strong>${C.esc(h.class_name)} ${C.esc(h.arm_name)}</strong></span>
      <span>Term: <strong>${C.esc(h.term_name)}</strong></span>
      <span>Session: <strong>${C.esc(h.session_name)}</strong></span>
      <span>No. in class: <strong>${h.no_in_class}</strong></span>
      <span>Subject teacher: <strong>${C.esc((h.teachers || []).join(', ') || '—')}</strong></span>
    </div>
  </div>`;
}

function gridHtml(sheet, editable) {
  const comps = scheme.components;
  const g1 = comps.filter(c => c.group === 'ca1'), g2 = comps.filter(c => c.group === 'ca2');
  const th = c => `<th class="sheet-col">${C.esc(c.label)}<small>${c.max}</small></th>`;
  const head = `<thead>
    <tr><th rowspan="2">S/N</th><th rowspan="2" class="sheet-name-col">Student name</th>
      <th colspan="${g1.length + 1}">1st continuous assessment</th><th colspan="${g2.length + 1}">2nd continuous assessment</th>
      <th rowspan="2" class="sheet-col">Exam<small>${scheme.exam_max}</small></th><th rowspan="2" class="sheet-col">Term's total<small>${scheme.total_max}</small></th><th rowspan="2">Grade</th>${editable ? '' : '<th rowspan="2" class="no-print">Status</th>'}</tr>
    <tr>${g1.map(th).join('')}<th class="sheet-col sheet-sub">Total<small>${scheme.groups.ca1.max}</small></th>${g2.map(th).join('')}<th class="sheet-col sheet-sub">Total<small>${scheme.groups.ca2.max}</small></th></tr>
  </thead>`;
  const input = (s, key) => `<td><input class="sheet-input" type="number" inputmode="decimal" min="0" max="${maxOf(key)}" step="0.5" data-code="${C.esc(s.user_code)}" data-key="${key}" value="${fmt(s.scores[key])}" ${editable ? '' : 'readonly tabindex="-1"'} aria-label="${C.esc(s.full_name)} ${key}"></td>`;
  const body = sheet.students.map((s, i) => `<tr data-row="${C.esc(s.user_code)}" data-state="${s.state}">
      <td>${i + 1}</td>
      <td class="sheet-name"><strong>${C.esc(s.full_name)}</strong><small>${C.esc(s.user_code)}${s.status === 'repeating' ? ' · repeating' : ''}${s.legacy_ca ? ` · earlier entry: CA ${s.ca_total}` : ''}</small><span class="sheet-row-msg" data-msg></span>${s.state === 'rejected' && s.rejection_note ? `<small class="sheet-reject">Sent back: ${C.esc(s.rejection_note)}</small>` : ''}</td>
      ${g1.map(c => input(s, c.key)).join('')}<td class="sheet-calc" data-calc="ca1"></td>
      ${g2.map(c => input(s, c.key)).join('')}<td class="sheet-calc" data-calc="ca2"></td>
      ${input(s, 'exam')}<td class="sheet-calc sheet-total" data-calc="total"></td><td class="sheet-calc" data-calc="grade"></td>
      ${editable ? '' : `<td class="no-print"><span class="portal-badge ${STATE_CLASS[s.state]}">${STATE_LABEL[s.state]}</span></td>`}
    </tr>`).join('');
  const cols = 6 + g1.length + g2.length + (editable ? 0 : 1);
  return `<div class="table-wrapper sheet-wrap"><table class="portal-table sheet-table">${head}<tbody>${body || `<tr><td colspan="${cols}"><div class="portal-empty">No active students are registered in this class and arm.</div></td></tr>`}</tbody></table></div>`;
}

// ------------------------------------------------------------ live arithmetic
function rowValues(tr) {
  const v = {};
  tr.querySelectorAll('.sheet-input').forEach(inp => { v[inp.dataset.key] = inp.value.trim(); });
  return v;
}
function recalcRow(tr) {
  const raw = rowValues(tr);
  let filled = 0, bad = false;
  const num = {};
  FIELDS().forEach(k => {
    const t = raw[k];
    if (t === '' || t === undefined) { num[k] = null; return; }
    filled += 1;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0 || n > maxOf(k)) { bad = true; num[k] = null; } else num[k] = n;
    const inp = tr.querySelector(`.sheet-input[data-key="${k}"]`);
    inp.classList.toggle('bad', !Number.isFinite(n) || n < 0 || n > maxOf(k));
  });
  FIELDS().forEach(k => { if (raw[k] === '') tr.querySelector(`.sheet-input[data-key="${k}"]`).classList.remove('bad'); });
  const sum = keys => r2(keys.reduce((a, k) => a + (num[k] || 0), 0));
  const g1 = scheme.components.filter(c => c.group === 'ca1').map(c => c.key), g2 = scheme.components.filter(c => c.group === 'ca2').map(c => c.key);
  const set = (name, text) => { tr.querySelector(`[data-calc="${name}"]`).textContent = text; };
  const status = bad ? 'bad' : filled === 0 ? 'blank' : filled === FIELDS().length ? 'complete' : 'partial';
  tr.dataset.fill = status;
  if (filled === 0) { set('ca1', ''); set('ca2', ''); set('total', ''); set('grade', ''); return status; }
  const ca1 = sum(g1), ca2 = sum(g2), ex = num.exam || 0, total = r2(ca1 + ca2 + ex);
  set('ca1', ca1); set('ca2', ca2); set('total', total);
  const gr = gradeOf(total);
  set('grade', status === 'complete' ? gr.grade : '');
  tr.querySelector('[data-calc="grade"]').className = `sheet-calc ${status === 'complete' ? C.gradeClass(gr.grade) : ''}`;
  return status;
}
function updateSummary() {
  const rows = [...document.querySelectorAll('.sheet-table tbody tr[data-row]')];
  const n = { complete: 0, partial: 0, bad: 0, blank: 0 };
  rows.forEach(tr => { n[tr.dataset.fill || 'blank'] += 1; });
  const el = $('#sheetSummary');
  if (!el) return;
  el.innerHTML = `<span><strong>${n.complete}</strong> complete</span><span class="${n.partial + n.bad ? 'sheet-warn' : ''}"><strong>${n.partial + n.bad}</strong> need attention</span><span><strong>${n.blank}</strong> blank (skipped)</span>`;
}
function recalcAll() { document.querySelectorAll('.sheet-table tbody tr[data-row]').forEach(recalcRow); updateSummary(); }

// ------------------------------------------------------------- draft handling
function collectEdits() {
  // Only rows that differ from what is saved are worth keeping as a draft.
  const out = {};
  const saved = new Map(view.sheet.students.map(s => [s.user_code, s.scores]));
  document.querySelectorAll('.sheet-table tbody tr[data-row]').forEach(tr => {
    const code = tr.dataset.row, ex = saved.get(code) || {}, vals = rowValues(tr);
    const changed = FIELDS().some(k => fmt(ex[k]) !== vals[k]);
    if (changed) out[code] = vals;
  });
  return out;
}
let draftTimer;
function scheduleDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => { writeDraft(view.params, collectEdits()); const el = $('#sheetDraftState'); if (el) el.textContent = 'Draft saved on this device'; }, 500);
}
function applyValues(map, { mark = false } = {}) {
  let touched = 0;
  Object.entries(map).forEach(([code, vals]) => {
    const tr = document.querySelector(`.sheet-table tr[data-row="${CSS.escape(code)}"]`);
    if (!tr) return;
    FIELDS().forEach(k => {
      const v = vals[k];
      if (v === null || v === undefined || v === '') return;
      const inp = tr.querySelector(`.sheet-input[data-key="${k}"]`);
      inp.value = String(v);
      if (mark) inp.classList.add('scanned');
    });
    touched += 1;
  });
  recalcAll();
  return touched;
}
function takeSnapshot() {
  view.snapshot = {};
  document.querySelectorAll('.sheet-table tbody tr[data-row]').forEach(tr => { view.snapshot[tr.dataset.row] = rowValues(tr); });
  const b = $('#sheetUndo'); if (b) b.hidden = false;
}
function undoFill() {
  if (!view.snapshot) return;
  document.querySelectorAll('.sheet-table tbody tr[data-row]').forEach(tr => {
    const s = view.snapshot[tr.dataset.row]; if (!s) return;
    tr.querySelectorAll('.sheet-input').forEach(inp => { inp.value = s[inp.dataset.key]; inp.classList.remove('scanned'); });
  });
  view.snapshot = null; $('#sheetUndo').hidden = true;
  recalcAll(); scheduleDraft(); C.toast('Reverted to the values before the last import or scan.', 'success');
}

// -------------------------------------------------------------- teacher screen
export function renderTeacherSheet() {
  const a = C.state.assignments || [];
  const terms = (C.state.meta?.terms || []);
  const aOpts = a.map(x => `<option value="${x.id}" data-session="${x.session_id}">${C.esc(x.class_name)} ${C.esc(x.arm_name)} — ${C.esc(x.subject_name)} (${C.esc(x.session_name)})</option>`).join('');
  const tOpts = terms.map(t => `<option value="${t.id}" data-session="${t.session_id}" ${t.is_current ? 'selected' : ''}>${C.esc(t.session_name)} — ${C.esc(t.term_name)}${t.result_locked ? ' (locked)' : ''}</option>`).join('');
  return `<div class="portal-toolbar no-print"><div><div class="eyebrow">Teacher workflow</div><h1>Score Sheet</h1><p>The same Continuous Assessment Sheet you use on paper. Fill it in, check the totals, then submit it to your HOD.</p></div>
      <a class="btn btn-secondary btn-auto" href="${sheetDownloadUrl('template')}" download>${C.ic('document', 16)} Blank Excel template</a></div>
    ${C.card('Choose a sheet', `<div class="portal-form-grid"><div class="form-group full"><label for="sheetAssignment">Class, arm and subject</label><select id="sheetAssignment"><option value="">Select…</option>${aOpts}</select></div><div class="form-group"><label for="sheetTerm">Term</label><select id="sheetTerm">${tOpts}</select></div><div class="form-group" style="align-self:end"><button class="btn btn-primary" id="openSheet">Open sheet</button></div></div>${a.length ? '' : '<p style="color:var(--text-secondary);margin-top:.75rem">You have no teaching assignments yet. Ask an administrator to assign your classes and subjects.</p>'}`, '', 'no-print')}
    <div id="sheetArea"></div>`;
}

export function bindTeacherSheet() {
  const aSel = $('#sheetAssignment'), tSel = $('#sheetTerm');
  // Offer only the terms that belong to the session of the chosen assignment.
  const syncTerms = () => {
    const sid = aSel.selectedOptions[0]?.dataset.session;
    [...tSel.options].forEach(o => { o.hidden = !!sid && o.dataset.session !== sid; o.disabled = o.hidden; });
    if (tSel.selectedOptions[0]?.disabled) { const ok = [...tSel.options].find(o => !o.disabled); if (ok) tSel.value = ok.value; }
  };
  aSel.onchange = syncTerms;
  if (C.state.assignments?.length === 1) { aSel.value = String(C.state.assignments[0].id); syncTerms(); }
  $('#openSheet').onclick = () => {
    if (!aSel.value || !tSel.value) return C.toast('Choose a class/subject and a term.', 'error');
    openTeacherSheet({ assignment_id: Number(aSel.value), term_id: Number(tSel.value) });
  };
}

async function openTeacherSheet(params) {
  const area = $('#sheetArea');
  area.innerHTML = '<div class="portal-loading"><span class="loading"></span><p>Opening the sheet…</p></div>';
  try {
    await loadScheme();
    const sheet = await getSheet(params);
    view.sheet = sheet; view.params = params; view.snapshot = null; view.readOnly = !sheet.can_edit;
    area.innerHTML = teacherSheetHtml(sheet);
    bindGrid(sheet);
  } catch (e) { area.innerHTML = `<div class="portal-card"><div class="portal-empty"><h3>Sheet could not be opened</h3><p>${C.esc(e.message)}</p></div></div>`; }
}

function teacherSheetHtml(sheet) {
  const edit = sheet.can_edit;
  const pdfParams = view.params;
  const toolbar = edit ? `<div class="sheet-tools no-print">
      <button class="btn btn-primary" id="sheetSave">Save &amp; submit to HOD</button>
      <label class="btn btn-secondary" for="sheetXlsx">${C.ic('document', 16)} Import Excel<input id="sheetXlsx" type="file" accept=".xlsx" hidden></label>
      <label class="btn btn-secondary" for="sheetPhoto" id="sheetPhotoLabel">${C.ic('cpu', 16)} Scan paper sheet<input id="sheetPhoto" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden></label>
      <a class="btn btn-secondary" href="${sheetDownloadUrl('export', pdfParams)}" download>Download Excel</a>
      <button class="btn btn-secondary" id="sheetPrint">${C.ic('printer', 16)} Print</button>
      <button class="btn btn-secondary" id="sheetUndo" hidden>Undo last import/scan</button>
    </div>` : `<div class="sheet-tools no-print"><a class="btn btn-secondary" href="${sheetDownloadUrl('export', pdfParams)}" download>Download Excel</a><button class="btn btn-secondary" id="sheetPrint">${C.ic('printer', 16)} Print</button></div>`;
  const c = sheet.counts;
  const lock = sheet.locked ? `<div class="ai-review-note ai-review-warn no-print">This term is locked, so the sheet is read-only. Ask an administrator to unlock it if a correction is needed.</div>` : '';
  const rules = edit ? `<div class="ai-review-note no-print"><strong>How it works:</strong> leave a student's row empty if they were not assessed. If you fill a row, fill every column (type 0 for a zero). Rows you do not change keep their approval; rows you change go back to your HOD. Limits: ${scheme.components.map(x => `${C.esc(x.label)} ${x.max}`).join(' · ')} · Exam ${scheme.exam_max}.</div>` : '';
  return `${lock}${rules}
    <section class="portal-card sheet-card"><div class="portal-card-body">
      ${headerBlock(sheet.header)}
      <div class="sheet-statusline no-print"><span class="portal-badge ok">${c.approved} approved</span><span class="portal-badge pending">${c.pending} awaiting HOD</span>${c.rejected ? `<span class="portal-badge danger">${c.rejected} sent back</span>` : ''}<span class="portal-badge">${c.none} not entered</span><span id="sheetDraftState" class="sheet-draft"></span></div>
      <div id="sheetNotice" class="no-print"></div>
      ${toolbar}
      ${gridHtml(sheet, edit)}
      <div id="sheetSummary" class="sheet-summary no-print"></div>
      <div class="sheet-signatures"><div>Subject teacher</div><div>Head of department</div><div>Form teacher</div></div>
    </div></section>`;
}

function showNotice(html, kind = '') { const n = $('#sheetNotice'); if (n) n.innerHTML = html ? `<div class="ai-review-note ${kind}">${html}</div>` : ''; }

function bindGrid(sheet) {
  const edit = sheet.can_edit;
  recalcAll();
  $('#sheetPrint')?.addEventListener('click', () => window.print());
  if (!edit) return;
  const table = $('.sheet-table');
  table.addEventListener('input', e => {
    if (!e.target.classList.contains('sheet-input')) return;
    e.target.classList.remove('scanned');
    const tr = e.target.closest('tr'); tr.classList.remove('row-error'); const m = tr.querySelector('[data-msg]'); if (m) m.textContent = '';
    recalcRow(tr); updateSummary(); scheduleDraft();
  });
  // Enter / arrow keys move down a column the way people tab through a paper sheet.
  table.addEventListener('keydown', e => {
    if (!e.target.classList.contains('sheet-input')) return;
    const dir = e.key === 'Enter' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const rows = [...table.querySelectorAll('tbody tr[data-row]')];
    const next = rows[rows.indexOf(e.target.closest('tr')) + dir];
    const target = next?.querySelector(`.sheet-input[data-key="${e.target.dataset.key}"]`);
    if (target) { target.focus(); target.select(); }
  });
  const draft = readDraft(view.params);
  if (draft && Object.keys(draft).length) {
    const touched = applyValues(draft);
    showNotice(`Unsaved work from earlier was restored for ${touched} student${touched === 1 ? '' : 's'}. <button class="btn btn-secondary btn-sm" id="discardDraft">Discard draft</button>`, 'ai-review-warn');
    $('#discardDraft').onclick = () => { writeDraft(view.params, null); openTeacherSheet(view.params); };
  }
  $('#sheetSave').onclick = saveCurrent;
  $('#sheetUndo').onclick = undoFill;
  $('#sheetXlsx').onchange = e => importExcel(e.target);
  $('#sheetPhoto').onchange = e => scanPhoto(e.target);
  if (view.aiAvailable === null) getAiStatus().then(s => { view.aiAvailable = !!s.available; if (!view.aiAvailable) $('#sheetPhotoLabel')?.classList.add('is-off'); }).catch(() => { view.aiAvailable = false; });
}

async function saveCurrent() {
  const btn = $('#sheetSave');
  const rows = [...document.querySelectorAll('.sheet-table tbody tr[data-row]')].map(tr => ({ student_code: tr.dataset.row, ...rowValues(tr) }));
  document.querySelectorAll('.sheet-table tr.row-error').forEach(tr => tr.classList.remove('row-error'));
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const out = await saveSheet({ ...view.params, rows });
    writeDraft(view.params, null);
    C.toast(out.message, 'success');
    await openTeacherSheet(view.params);
  } catch (e) {
    const errs = e.data?.row_errors;
    if (errs?.length) {
      errs.forEach(re => {
        const tr = document.querySelector(`.sheet-table tr[data-row="${CSS.escape(re.student_code)}"]`);
        if (!tr) return;
        tr.classList.add('row-error');
        const m = tr.querySelector('[data-msg]'); if (m) m.textContent = re.messages.join(' ');
      });
      showNotice(`<strong>${C.esc(e.message)}</strong> Rows to fix are marked in red below. Nothing was saved.`, 'ai-review-warn');
      document.querySelector('.sheet-table tr.row-error')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    C.toast(e.message, 'error');
  } finally { const b = $('#sheetSave'); if (b) { b.disabled = false; b.innerHTML = 'Save &amp; submit to HOD'; } }
}

const readAsDataUrl = file => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });

async function importExcel(input) {
  const file = input.files?.[0]; input.value = '';
  if (!file) return;
  if (!/\.xlsx$/i.test(file.name)) return C.toast('Choose an Excel (.xlsx) file — use the template or the downloaded sheet.', 'error');
  showNotice('Reading the Excel file…');
  try {
    const out = await importSheetFile({ ...view.params, file: await readAsDataUrl(file) });
    takeSnapshot();
    const touched = applyValues(Object.fromEntries(out.rows.map(r => [r.user_code, r.scores])));
    scheduleDraft();
    const skipped = out.unmatched || [];
    const probs = out.rows.filter(r => r.problems?.length).length;
    showNotice(`<strong>${touched}</strong> of ${out.roster_count} students filled from <em>${C.esc(file.name)}</em>. Check the totals, then press Save &amp; submit.${skipped.length ? `<br><strong>${skipped.length} row${skipped.length === 1 ? '' : 's'} not matched to this class:</strong> ${skipped.slice(0, 8).map(u => C.esc(u.name || `line ${u.line}`)).join(', ')}${skipped.length > 8 ? '…' : ''}` : ''}${probs ? `<br>${probs} row(s) had values that could not be read as numbers.` : ''}${(out.warnings || []).map(w => `<br>${C.esc(w)}`).join('')}`, skipped.length || probs ? 'ai-review-warn' : '');
  } catch (e) { showNotice(`<strong>Import failed.</strong> ${C.esc(e.message)}`, 'ai-review-warn'); }
}

async function scanPhoto(input) {
  const file = input.files?.[0]; input.value = '';
  if (!file) return;
  if (view.aiAvailable === false) return C.toast('The photo scanner is not available on this server. Type the scores in, or use Excel import.', 'error');
  showNotice('Reading the photo… this can take up to a minute.');
  try {
    const image = await readAsDataUrl(file);
    const out = await aiImportScores({ ...view.params, image });
    if (!out.rows.length) return showNotice('<strong>No student rows could be recognised.</strong> Retake the photo flat, in good light, with the whole table in frame — or type the scores in.', 'ai-review-warn');
    takeSnapshot();
    const map = {}; out.rows.forEach(r => { map[r.user_code] = r.scores; });
    const touched = applyValues(map, { mark: true });
    // Anything the scanner was unsure about is flagged for a human check.
    const unsure = out.rows.filter(r => r.confidence < 0.85 || (r.out_of_range || []).length || r.note);
    unsure.forEach(r => { const tr = document.querySelector(`.sheet-table tr[data-row="${CSS.escape(r.user_code)}"]`); const m = tr?.querySelector('[data-msg]'); if (m) m.textContent = r.note || ((r.out_of_range || []).length ? `Check: ${r.out_of_range.join(', ')} looked out of range.` : 'Low confidence — please check this row.'); });
    scheduleDraft();
    showNotice(`<strong>${touched}</strong> of ${out.roster_count} students read from the photo. Cells filled by the scanner are tinted — <strong>check every one against the paper sheet</strong>. ${unsure.length ? `${unsure.length} row(s) are flagged for a closer look.` : ''} Nothing is submitted until you press Save &amp; submit.`, unsure.length ? 'ai-review-warn' : '');
  } catch (e) { showNotice(`<strong>Scan could not be completed.</strong> ${C.esc(e.message)} You can still type the scores in or import Excel.`, 'ai-review-warn'); }
}

// ------------------------------------------- HOD / Admin / Commandant browser
export function renderSheetBrowser() {
  const terms = C.state.meta?.terms || [];
  const role = C.state.user.role;
  if (!view.termId) view.termId = String((terms.find(t => t.is_current) || terms[0] || {}).id || '');
  const tOpts = terms.map(t => `<option value="${t.id}" ${String(t.id) === String(view.termId) ? 'selected' : ''}>${C.esc(t.session_name)} — ${C.esc(t.term_name)}</option>`).join('');
  const classes = C.state.meta?.classes || [], depts = C.state.meta?.departments || [];
  const classOpts = `<option value="">All classes</option>${classes.map(c => `<option value="${c.id}">${C.esc(c.level_name)}</option>`).join('')}`;
  const deptOpts = role === 'hod' ? '' : `<select id="sbDept" class="btn-auto"><option value="">All departments</option>${depts.map(d => `<option value="${d.id}">${C.esc(d.dept_name)}</option>`).join('')}</select>`;
  const statusOpts = `<option value="">Any status</option>${Object.entries(SHEET_STATUS).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}`;
  return `<div class="portal-toolbar no-print"><div><div class="eyebrow">${role === 'hod' ? 'Department' : 'School'} results</div><h1>Result Sheets</h1><p>Every class sheet for the term, with how far each one has got. Open one to read it exactly as the teacher entered it.</p></div>
      <a class="btn btn-secondary btn-auto" href="${sheetDownloadUrl('template')}" download>${C.ic('document', 16)} Blank Excel template</a></div>
    <div id="sheetBrowser">${C.card('Sheets', `<div class="portal-actions" style="margin-bottom:1rem"><select id="sbTerm" class="btn-auto">${tOpts}</select><select id="sbClass" class="btn-auto">${classOpts}</select>${deptOpts}<select id="sbStatus" class="btn-auto">${statusOpts}</select></div><div id="sbTable"><div class="portal-loading"><span class="loading"></span></div></div>`, '', 'no-print')}</div>
    <div id="sheetArea"></div>`;
}

export function bindSheetBrowser() {
  const f = view.filters;
  $('#sbClass').value = f.class_level_id; $('#sbStatus').value = f.status; if ($('#sbDept')) $('#sbDept').value = f.dept_id;
  const load = async () => {
    view.termId = $('#sbTerm').value;
    f.class_level_id = $('#sbClass').value; f.status = $('#sbStatus').value; f.dept_id = $('#sbDept')?.value || '';
    $('#sbTable').innerHTML = '<div class="portal-loading"><span class="loading"></span></div>';
    try { view.termIndex = await getSheetIndex(Number(view.termId)); drawSheetTable(); }
    catch (e) { $('#sbTable').innerHTML = `<div class="portal-empty">${C.esc(e.message)}</div>`; }
  };
  ['sbTerm', 'sbClass', 'sbStatus', 'sbDept'].forEach(id => { const el = $('#' + id); if (el) el.onchange = id === 'sbTerm' ? load : () => { f.class_level_id = $('#sbClass').value; f.status = $('#sbStatus').value; f.dept_id = $('#sbDept')?.value || ''; drawSheetTable(); }; });
  if (view.termId) load(); else $('#sbTable').innerHTML = '<div class="portal-empty">No academic terms have been set up yet.</div>';
}

function drawSheetTable() {
  const idx = view.termIndex, f = view.filters;
  if (!idx) return;
  const list = idx.sheets.filter(s => (!f.class_level_id || String(s.class_level_id) === f.class_level_id) && (!f.dept_id || String(s.dept_id) === f.dept_id) && (!f.status || s.status === f.status));
  const rows = list.map(s => {
    const pct = s.roster_count ? Math.round(Math.min(s.entered, s.roster_count) / s.roster_count * 100) : 0;
    const [label, cls] = SHEET_STATUS[s.status];
    return `<tr><td><strong>${C.esc(s.class_name)} ${C.esc(s.arm_name)}</strong><br><small>${C.esc(s.subject_name)}${s.dept_name ? ` · ${C.esc(s.dept_name)}` : ''}</small></td><td>${C.esc(s.teacher_name)}</td>
      <td style="min-width:140px">${s.entered}/${s.roster_count} entered<div class="portal-progress"><span style="width:${pct}%"></span></div></td>
      <td>${s.approved} ✓ · ${s.pending} waiting${s.rejected ? ` · <span style="color:var(--danger)">${s.rejected} sent back</span>` : ''}</td>
      <td>${s.avg_score === null ? '—' : s.avg_score}</td><td><span class="portal-badge ${cls}">${label}</span></td>
      <td><button class="btn btn-secondary btn-sm" data-open-sheet="${s.class_level_id}|${s.arm_id}|${s.subject_id}">Open</button></td></tr>`;
  }).join('');
  const c = { approved: 0, submitted: 0, in_progress: 0, not_started: 0 };
  idx.sheets.forEach(s => { c[s.status] += 1; });
  $('#sbTable').innerHTML = `<div class="sheet-statusline"><span class="portal-badge ok">${c.approved} approved</span><span class="portal-badge pending">${c.submitted} awaiting approval</span><span class="portal-badge pending">${c.in_progress} in progress</span><span class="portal-badge danger">${c.not_started} not started</span>${idx.term.result_locked ? '<span class="portal-badge danger">Term locked</span>' : ''}</div>${C.table(['Class & subject', 'Teacher', 'Entered', 'Approval', 'Avg', 'Status', ''], rows, 'No sheets match these filters.')}`;
  document.querySelectorAll('[data-open-sheet]').forEach(b => b.onclick = () => {
    const [class_level_id, arm_id, subject_id] = b.dataset.openSheet.split('|').map(Number);
    openReadOnly({ class_level_id, arm_id, subject_id, term_id: Number(view.termId) });
  });
}

async function openReadOnly(params) {
  const area = $('#sheetArea');
  area.innerHTML = '<div class="portal-loading"><span class="loading"></span></div>';
  try {
    await loadScheme();
    const sheet = await getSheet(params);
    view.sheet = sheet; view.params = params;
    const canApprove = C.state.user.role === 'hod' && !sheet.locked && sheet.counts.pending > 0;
    area.innerHTML = `<section class="portal-card sheet-card"><div class="portal-card-body">
      ${headerBlock(sheet.header)}
      <div class="sheet-statusline no-print"><span class="portal-badge ok">${sheet.counts.approved} approved</span><span class="portal-badge pending">${sheet.counts.pending} awaiting approval</span>${sheet.counts.rejected ? `<span class="portal-badge danger">${sheet.counts.rejected} sent back</span>` : ''}<span class="portal-badge">${sheet.counts.none} not entered</span></div>
      <div class="sheet-tools no-print">${canApprove ? `<button class="btn btn-primary" id="sheetApprove">Approve ${sheet.counts.pending} pending</button>` : ''}<a class="btn btn-secondary" href="${sheetDownloadUrl('export', params)}" download>Download Excel</a><button class="btn btn-secondary" id="sheetPrint">${C.ic('printer', 16)} Print</button><button class="btn btn-secondary" id="sheetClose">Close</button></div>
      ${gridHtml(sheet, false)}
      <div class="sheet-signatures"><div>Subject teacher</div><div>Head of department</div><div>Form teacher</div></div>
    </div></section>`;
    recalcAll();
    $('#sheetPrint').onclick = () => window.print();
    $('#sheetClose').onclick = () => { area.innerHTML = ''; };
    $('#sheetApprove')?.addEventListener('click', async () => {
      if (!confirm(`Approve all ${sheet.counts.pending} pending result(s) on this sheet? Students will be able to see them.`)) return;
      try { const out = await approveSheet({ subject_id: params.subject_id, class_level_id: params.class_level_id, arm_id: params.arm_id, term_id: params.term_id }); C.toast(out.message, 'success'); view.termIndex = await getSheetIndex(Number(view.termId)); drawSheetTable(); openReadOnly(params); }
      catch (e) { C.toast(e.message, 'error'); }
    });
    area.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { area.innerHTML = `<div class="portal-card"><div class="portal-empty">${C.esc(e.message)}</div></div>`; }
}
