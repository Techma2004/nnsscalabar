// NNSS Calabar - the "needs your attention" parts of every dashboard.
// Counts and lists come from /api/dashboard/attention (real database figures).
import { getAttention } from './api.js';
import { describeRequest } from './people.js';

let C = null;
export function init(ctx) { C = ctx; }

export async function load() { C.state.attention = await getAttention().catch(() => ({})); }

const SHEET = { not_started: ['Not started', 'danger'], in_progress: ['In progress', 'pending'], submitted: ['Awaiting HOD', 'pending'], approved: ['Approved', 'ok'] };

function todo(items) {
  const open = items.filter(i => i.count > 0);
  if (!open.length) return `<div class="all-clear">${C.ic('checkcircle', 18)}<span>Nothing needs your attention right now.</span></div>`;
  return open.map(i => `<div class="todo-row"><span class="todo-count">${i.count}</span><div><strong>${C.esc(i.title)}</strong><br><small>${C.esc(i.hint)}</small></div><button class="btn btn-secondary btn-sm" data-go="${i.go}">${C.esc(i.cta)} ${C.ic('arrowright', 13)}</button></div>`).join('');
}

export function studentCard() {
  const a = C.state.attention || {};
  const decisions = (a.recent_decisions || []).map(d => `<div class="portal-kpi"><span>${C.esc(describeRequest(d))}<br><small>${C.esc(d.review_note || '')}</small></span><strong class="portal-badge ${d.status === 'approved' ? 'ok' : 'danger'}">${d.status === 'approved' ? 'Accepted' : 'Declined'}</strong></div>`).join('');
  return C.card('My requests', `<p>${a.open_requests ? `You have <strong>${a.open_requests}</strong> request${a.open_requests === 1 ? '' : 's'} waiting for your HOD.` : 'Ask your HOD to change your arm, or to add or drop a subject.'}</p>${decisions ? `<h4 class="card-subhead">Recent decisions</h4>${decisions}` : ''}<div class="portal-actions" style="margin-top:.8rem"><button class="btn btn-primary" data-go="requests">${C.ic('swap', 15)} ${a.open_requests ? 'View my requests' : 'Make a request'}</button></div>`);
}

export function teacherCard() {
  const a = C.state.attention || {};
  if (!a.term) return C.card('Score sheets', '<div class="portal-empty">No academic term is set up yet.</div>');
  const rows = (a.sheets || []).map(s => {
    const [label, cls] = SHEET[s.status] || ['—', ''];
    const pct = s.roster_count ? Math.round(Math.min(s.entered, s.roster_count) / s.roster_count * 100) : 0;
    return `<tr><td><strong>${C.esc(s.class_name)} ${C.esc(s.arm_name)}</strong><br><small>${C.esc(s.subject_name)}</small></td><td style="min-width:130px">${s.entered} of ${s.roster_count}<div class="portal-progress"><span style="width:${pct}%"></span></div></td><td>${s.rejected ? `<span class="portal-badge danger">${s.rejected} sent back</span>` : `<span class="portal-badge ${cls}">${label}</span>`}</td><td><button class="btn btn-secondary btn-sm" data-go="sheet">Open</button></td></tr>`;
  }).join('');
  const left = (a.sheets || []).filter(s => s.status === 'not_started' || s.status === 'in_progress').length;
  return C.card(`Score sheets, ${C.esc(a.term.term_name)} ${C.esc(a.term.session_name)}`, `${left ? `<p style="margin-bottom:.6rem"><strong>${left}</strong> sheet${left === 1 ? ' is' : 's are'} not finished yet.</p>` : ''}${C.table(['Class and subject', 'Entered', 'Status', ''], rows, 'You have no classes assigned this session. Ask your HOD or an administrator.')}`);
}

export function hodCard(h) {
  const a = C.state.attention || {};
  return C.card('Needs your attention', todo([
    { count: h ? Number(h.pending_results) : 0, title: 'Results waiting for your approval', hint: 'Students cannot see them until you approve.', go: 'approval', cta: 'Review' },
    { count: a.pending_requests || 0, title: 'Student change requests', hint: 'Arm changes and subject changes to accept or decline.', go: 'requests', cta: 'Review' },
    { count: a.staff_missing_phone || 0, title: 'Teachers with no phone number', hint: 'Ask an administrator to add it so you can reach them.', go: 'teachers', cta: 'See teachers' }
  ])) + C.card('My department', `<div class="portal-actions"><button class="btn btn-secondary" data-go="teachers">${C.ic('idbadge', 15)} Department teachers</button><button class="btn btn-secondary" data-go="students">${C.ic('users', 15)} Department students</button><button class="btn btn-secondary" data-go="sheets">${C.ic('document', 15)} Class score sheets</button></div>`);
}

export function managementCard(role) {
  const a = C.state.attention || {};
  const actions = [['accounts', 'userplus', 'Create an account'], ['announcements', 'bell', 'Publish a notice'], ['requests', 'swap', 'Change requests'], ['sheets', 'document', 'Class score sheets'], ['students', 'users', 'Students'], ['teachers', 'idbadge', 'Teachers']];
  return C.card('Needs your attention', todo([
    { count: a.pending_requests || 0, title: 'Student change requests waiting', hint: 'Arm and subject changes students have asked for.', go: 'requests', cta: 'Review' },
    { count: a.staff_missing_phone || 0, title: 'Staff accounts with no phone number', hint: 'Open the account and add a number so they can be reached.', go: 'accounts', cta: 'Fix' },
    { count: a.students_missing_guardian_phone || 0, title: 'Students with no guardian phone number', hint: 'Open each profile and add the parent or guardian number.', go: 'students', cta: 'Fix' }
  ])) + C.card('Quick actions', `<div class="portal-actions">${actions.map(([go, icon, label]) => `<button class="btn btn-secondary" data-go="${go}">${C.ic(icon, 15)} ${label}</button>`).join('')}${role === 'commandant' || role === 'admin' ? `<button class="btn btn-secondary" data-go="content">${C.ic('newspaper', 15)} Blog &amp; newsletter</button>` : ''}</div>`);
}

export function editorDashboard() {
  const a = C.state.attention || {};
  return `<div class="portal-toolbar"><div><div class="eyebrow">School news team</div><h1>Welcome, ${C.esc(C.state.user.name.split(' ')[0])}</h1><p>You look after what the public reads on the school's Blog and Newsletter pages.</p></div></div>
    <div class="portal-grid">${C.stat('Posts', a.total ?? 0, 'newspaper')}${C.stat('Blog', a.blog ?? 0, 'document')}${C.stat('Newsletter', a.newsletter ?? 0, 'mail')}${C.stat('Drafts', a.drafts ?? 0, 'pencil')}</div>
    ${C.card('What to do', `<div class="portal-actions"><button class="btn btn-primary" data-go="content">${C.ic('plus', 15)} Write or edit posts</button><a class="btn btn-secondary" href="blog.html" target="_blank" rel="noopener">${C.ic('globe', 15)} See the blog</a><a class="btn btn-secondary" href="newsletter.html" target="_blank" rel="noopener">${C.ic('globe', 15)} See the newsletter</a></div>${a.drafts ? `<p style="margin-top:.8rem">${a.drafts} draft${a.drafts === 1 ? ' is' : 's are'} waiting to be published.</p>` : ''}`)}`;
}
