// NNSS Calabar - Commandant interface: dashboard, school overview, top performers.
// All figures come from /api/dashboard/commandant-summary and /top-performers,
// which only the commandant role may call.
import { getCommandantSummary, getTopPerformers } from './api.js';

let C = null;
export function init(ctx) { C = ctx; }

const v = (n, suffix = '') => (n === null || n === undefined ? '—' : `${n}${suffix}`);
const GRADE_ORDER = ['A1', 'B2', 'B3', 'C4', 'C5', 'C6', 'D7', 'E8', 'F9'];
const SHEET_LABEL = { not_started: 'Not started', in_progress: 'In progress', submitted: 'Awaiting HOD', approved: 'Approved' };

export async function loadSummary(termId) {
  C.state.cmdSummary = await getCommandantSummary(termId || C.state.cmdTermId || undefined);
  if (C.state.cmdSummary.term) C.state.cmdTermId = C.state.cmdSummary.term.id;
}
export async function loadTop() {
  const f = C.state.topFilters || (C.state.topFilters = { term_id: '', class_level_id: '' });
  C.state.top = await getTopPerformers({ term_id: f.term_id, class_level_id: f.class_level_id, limit: 20 });
}

function termPicker() {
  const s = C.state.cmdSummary;
  if (!s || !s.terms?.length) return '';
  return `<select id="cmdTerm" class="btn-auto" aria-label="Term">${s.terms.map(t => `<option value="${t.id}" ${s.term && t.id === s.term.id ? 'selected' : ''}>${C.esc(t.session_name)} — ${C.esc(t.term_name)}${t.is_current ? ' (current)' : ''}</option>`).join('')}</select>`;
}

function emptyState() {
  return `<div class="portal-toolbar"><div><div class="eyebrow">Commandant</div><h1>Commandant overview</h1></div></div>${C.card('No academic term yet', '<p>No academic term has been set up. Open <strong>Academic Sessions</strong> to create a session and its terms; results will appear here once teachers start entering scores.</p><button class="btn btn-primary" data-go="sessions">Open academic sessions</button>')}`;
}

function bars(items, max, cls = '') {
  return items.map(([label, n]) => `<div class="bar-row"><span class="bar-label">${C.esc(label)}</span><div class="bar-track"><span class="bar-fill ${cls}" style="width:${max ? Math.round(n / max * 100) : 0}%"></span></div><span class="bar-n">${n}</span></div>`).join('');
}

export function renderDashboard() {
  const s = C.state.cmdSummary;
  if (!s || !s.term) return emptyState();
  const p = s.pipeline, perf = s.performance, h = s.headcount, sh = s.sheets.counts;
  const gradeMap = Object.fromEntries(s.grades.map(g => [g.grade, g.n]));
  const gradeMax = Math.max(1, ...GRADE_ORDER.map(g => gradeMap[g] || 0));
  const pctSheets = sh.total ? Math.round(sh.approved / sh.total * 100) : 0;
  const pipeTotal = Math.max(1, p.total);
  const behind = s.sheets.behind.map(b => `<div class="ai-note-row"><div><strong>${C.esc(b.class_name)} ${C.esc(b.arm_name)} · ${C.esc(b.subject_name)}</strong><br><small>${C.esc(b.teacher_name)} · ${b.entered}/${b.roster_count} entered · ${SHEET_LABEL[b.status]}</small></div></div>`).join('') || '<p style="color:var(--text-secondary)">Every sheet is under way or finished.</p>';
  const top = s.top.map((t, i) => `<tr><td><span class="portal-badge ${i < 3 ? 'ok' : ''}">#${i + 1}</span></td><td><strong>${C.esc(t.full_name)}</strong><br><small>${C.esc(t.user_code)}</small></td><td>${C.esc(t.class)} ${C.esc(t.arm)}</td><td><strong>${t.avg_score}%</strong></td></tr>`).join('');
  return `<div class="portal-toolbar"><div><div class="eyebrow">Commandant</div><h1>Commandant overview</h1><p>${C.esc(s.term.term_name)}, ${C.esc(s.term.session_name)}${s.term.result_locked ? ' · results locked' : ''}</p></div>${termPicker()}</div>
    <div class="portal-grid">${C.stat('Students', h.students, 'users')}${C.stat('Teachers', h.teachers, 'idbadge')}${C.stat('Heads of department', h.hods, 'shield')}${C.stat('Departments', h.departments, 'grid')}</div>
    <div class="portal-grid">${C.stat('Term average', v(perf.average, '%'), 'trendingup')}${C.stat('Pass rate (≥50)', v(perf.pass_rate, '%'), 'checkcircle')}${C.stat('Approved results', p.approved, 'barchart')}${C.stat('Awaiting approval', p.pending, 'clock')}</div>
    ${C.card('Results pipeline', `<p style="margin-bottom:.6rem">${p.total} result${p.total === 1 ? '' : 's'} entered this term.</p>
      <div class="pipeline"><span class="pipe-ok" style="width:${p.approved / pipeTotal * 100}%"></span><span class="pipe-wait" style="width:${p.pending / pipeTotal * 100}%"></span><span class="pipe-bad" style="width:${p.rejected / pipeTotal * 100}%"></span></div>
      <div class="pipeline-key"><span><i class="pipe-ok"></i>${p.approved} approved</span><span><i class="pipe-wait"></i>${p.pending} awaiting HOD</span><span><i class="pipe-bad"></i>${p.rejected} sent back</span></div>`)}
    <div class="cmd-two">
      ${C.card('Class sheet progress', `<div class="portal-kpi"><span>Sheets fully approved</span><strong>${sh.approved} of ${sh.total}</strong></div><div class="portal-progress"><span style="width:${pctSheets}%"></span></div>
        <div class="sheet-statusline" style="margin-top:.8rem"><span class="portal-badge ok">${sh.approved} approved</span><span class="portal-badge pending">${sh.submitted} awaiting HOD</span><span class="portal-badge pending">${sh.in_progress} in progress</span><span class="portal-badge danger">${sh.not_started} not started</span></div>
        <h4 style="margin:1rem 0 .3rem">Furthest behind</h4>${behind}`, `<button class="btn btn-secondary btn-sm" data-go="sheets">All sheets</button>`)}
      ${C.card('Grade distribution (approved)', s.grades.length ? bars(GRADE_ORDER.map(g => [g, gradeMap[g] || 0]), gradeMax) : '<div class="portal-empty">No approved results yet for this term.</div>')}
    </div>
    ${C.card('Top 5 students', C.table(['Rank', 'Student', 'Class', 'Average'], top, 'No approved results yet for this term.'), `<button class="btn btn-secondary btn-sm" data-go="top">Full ranking</button>`)}`;
}

export function renderOverview() {
  const s = C.state.cmdSummary;
  if (!s || !s.term) return emptyState();
  const classRows = s.classes.map(c => `<tr><td><strong>${C.esc(c.class_name)} ${C.esc(c.arm_name)}</strong></td><td>${c.students_scored}</td><td>${c.results}</td><td>${v(c.avg_score)}</td><td>${v(c.pass_rate, '%')}</td></tr>`).join('');
  const deptRows = s.departments.map(d => `<tr><td><strong>${C.esc(d.dept_name)}</strong></td><td>${d.results}</td><td>${d.approved}</td><td>${d.pending}</td><td>${v(d.avg_score)}</td><td>${v(d.pass_rate, '%')}</td></tr>`).join('');
  return `<div class="portal-toolbar"><div><div class="eyebrow">Commandant</div><h1>School Overview</h1><p>${C.esc(s.term.term_name)}, ${C.esc(s.term.session_name)} — approved results only.</p></div>${termPicker()}<button class="btn btn-secondary no-print" data-action="print">${C.ic('printer', 16)} Print</button></div>
    ${C.card('Performance by class', C.table(['Class', 'Students scored', 'Results', 'Average', 'Pass rate'], classRows, 'No approved results yet for this term.'))}
    ${C.card('Performance by department', C.table(['Department', 'Results', 'Approved', 'Awaiting', 'Average', 'Pass rate'], deptRows, 'No departments found.'))}`;
}

export function renderTop() {
  const f = C.state.topFilters || { term_id: '', class_level_id: '' };
  const terms = C.state.meta?.terms || [], classes = C.state.meta?.classes || [];
  const rows = C.state.top.map((r, i) => `<tr><td><span class="portal-badge ${i < 3 ? 'ok' : ''}">#${i + 1}</span></td><td><strong>${C.esc(r.full_name)}</strong><br><small>${C.esc(r.user_code)}</small></td><td>${C.esc(r.class)} ${C.esc(r.arm)}</td><td><strong>${r.avg_score}%</strong></td><td>${r.subjects_taken}</td></tr>`).join('');
  const tOpts = `<option value="">All terms</option>${terms.map(t => `<option value="${t.id}" ${String(t.id) === String(f.term_id) ? 'selected' : ''}>${C.esc(t.session_name)} — ${C.esc(t.term_name)}</option>`).join('')}`;
  const cOpts = `<option value="">All classes</option>${classes.map(c => `<option value="${c.id}" ${String(c.id) === String(f.class_level_id) ? 'selected' : ''}>${C.esc(c.level_name)}</option>`).join('')}`;
  return `<div class="portal-toolbar"><div><div class="eyebrow">Academic excellence</div><h1>Top Performers</h1><p>Ranked by average of approved results.</p></div><div class="portal-actions"><select id="topTerm" class="btn-auto">${tOpts}</select><select id="topClass" class="btn-auto">${cOpts}</select></div></div>${C.card('Top 20 students', C.table(['Rank', 'Student', 'Class', 'Average', 'Subjects'], rows, 'No approved results match these filters.'))}`;
}

export function bind(panel) {
  const picker = document.getElementById('cmdTerm');
  if (picker) picker.onchange = () => { C.state.cmdTermId = Number(picker.value); C.render(panel); };
  if (panel === 'top') {
    const f = C.state.topFilters;
    const apply = () => { f.term_id = document.getElementById('topTerm').value; f.class_level_id = document.getElementById('topClass').value; C.render('top'); };
    document.getElementById('topTerm').onchange = apply; document.getElementById('topClass').onchange = apply;
  }
}
