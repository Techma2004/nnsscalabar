// NNSS Calabar - people directory and profile pages.
//
//   Teachers / Students panels  searchable lists (HOD: their own department;
//                               Admin and Commandant: everyone)
//   Person panel                one person's profile: who they are, how to reach
//                               them, what they teach / study, and what they have
//                               done. Everything shown comes from the database.
import { getDirectory, getProfile, updateContact } from './api.js';

let C = null;
export function init(ctx) { C = ctx; }

const ACTIONS = {
  CREATE_USER: 'Account created', UPDATE_CONTACT: 'Contact details updated', DEACTIVATE_USER: 'Portal access removed', RESET_PASSWORD: 'Password reset',
  UPDATE_TEACHER_ASSIGNMENTS: 'Teaching assignments changed', MIGRATE_TEACHER_DEPARTMENT: 'Moved to another department', APPROVE_CHANGE_REQUEST: 'Accepted a change request',
  DECLINE_CHANGE_REQUEST: 'Declined a change request', CREATE_POST: 'Wrote a blog / newsletter post', UPDATE_POST: 'Edited a blog / newsletter post', DELETE_POST: 'Deleted a blog / newsletter post',
  CREATE_SUBJECT: 'Added a subject', UPDATE_SUBJECT: 'Edited a subject', PROMOTE_STUDENTS: 'Promoted students'
};
const actionLabel = a => ACTIONS[a] || String(a || '').toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const ROLE_LABEL = { student: 'Student', teacher: 'Teacher', hod: 'Head of Department', admin: 'Administrator', commandant: 'Commandant', editor: 'News team' };

// A number or address people can tap to call / write. A missing one is shown plainly
// so it can be fixed, never hidden.
export const phoneLink = (n, empty = 'Missing') => (n ? `<a class="contact-link" href="tel:${C.esc(n)}">${C.ic('phone', 14)}<span>${C.esc(n)}</span></a>` : `<span class="portal-badge danger">${C.esc(empty)}</span>`);
export const mailLink = e => (e ? `<a class="contact-link" href="mailto:${C.esc(e)}">${C.ic('mail', 14)}<span>${C.esc(e)}</span></a>` : '<span class="contact-none">—</span>');
const personBtn = (userId, name, code) => `<button type="button" class="person-link" data-open-person="${userId}"><strong>${C.esc(name)}</strong><small>${C.esc(code)}</small></button>`;

// ------------------------------------------------------------------ directory
export async function loadDirectory(kind) {
  const q = C.state.search[kind];
  const status = kind === 'students' ? C.state.studentStatusFilter : undefined;
  const r = await getDirectory(kind, q, status);
  C.state.dir = { kind, rows: r.rows, truncated: r.truncated, scope: r.scope };
}

export function renderDirectory(kind) {
  const d = C.state.dir || { rows: [], scope: null };
  const role = C.state.user.role;
  const manage = ['admin', 'commandant'].includes(role);
  const scope = d.scope ? ` in ${C.esc(d.scope)}` : '';
  if (kind === 'teachers') {
    const rows = d.rows.map(t => `<tr><td>${personBtn(t.user_id, t.full_name, t.user_code)}</td><td>${C.esc(t.department || '—')}</td><td>${C.esc(t.subjects || '—')}</td><td>${phoneLink(t.phone)}</td><td>${mailLink(t.email)}</td><td class="portal-actions"><button class="btn btn-secondary btn-sm" data-open-person="${t.user_id}">Open profile</button></td></tr>`).join('');
    const missing = d.rows.filter(t => !t.phone).length;
    return `<div class="portal-toolbar"><div><div class="eyebrow">${role === 'hod' ? 'My department' : 'Staff directory'}</div><h1>Teachers${scope}</h1><p>${d.rows.length} teacher${d.rows.length === 1 ? '' : 's'}. Tap a phone number to call, or open a profile to see their classes and activity.</p></div>${C.searchBox('teachers', 'Search by name, ID or subject…')}</div>
      ${missing ? `<div class="ai-review-note ai-review-warn">${missing} teacher${missing === 1 ? ' has' : 's have'} no phone number on file.${manage ? ' Open the profile to add it.' : ' Ask an administrator to add it.'}</div>` : ''}
      ${C.card('Teaching staff', C.table(['Teacher', 'Department', 'Subjects', 'Phone', 'Email', ''], rows, 'No teachers match this search.') + C.truncatedNote(d.truncated, 'teacher'))}`;
  }
  const statusSel = `<select id="studentStatusFilter" class="btn-auto" aria-label="Status"><option value="active">Active</option>${manage ? '<option value="pending">Pending (yet to resume)</option><option value="withdrawn">Withdrawn</option><option value="graduated">Graduated</option><option value="all">All statuses</option>' : ''}</select>`;
  const rows = d.rows.map(s => `<tr><td>${personBtn(s.user_id, s.full_name, s.user_code)}</td><td>${C.esc(s.class)} ${C.esc(s.arm)}</td><td>${C.esc(s.track)}</td><td>${C.esc(s.parent_name || '—')}</td><td>${phoneLink(s.parent_phone)}</td><td><span class="portal-badge ${s.status === 'active' ? 'ok' : s.status === 'withdrawn' ? 'danger' : 'pending'}">${C.esc(s.status)}</span></td><td class="portal-actions"><button class="btn btn-secondary btn-sm" data-open-person="${s.user_id}">Open profile</button>${manage ? `<button class="btn btn-secondary btn-sm" data-status-student-user="${s.user_id}" data-status-name="${C.esc(s.full_name)}" data-status-current="${C.esc(s.status)}">Change status</button>` : ''}</td></tr>`).join('');
  const missing = d.rows.filter(s => !s.parent_phone).length;
  return `<div class="portal-toolbar"><div><div class="eyebrow">${role === 'hod' ? 'My department' : 'Student register'}</div><h1>Students${scope}</h1><p>${role === 'hod' ? 'Students taking at least one subject of your department this session. ' : ''}${d.rows.length} shown. The phone number is the parent or guardian's.</p></div><div class="portal-actions">${C.searchBox('students', 'Search by name, ID or admission no…')}${statusSel}</div></div>
    ${missing ? `<div class="ai-review-note ai-review-warn">${missing} student${missing === 1 ? ' has' : 's have'} no guardian phone number on file.${manage ? ' Open the profile to add it.' : ''}</div>` : ''}
    ${C.card('Students', C.table(['Student', 'Class', 'Track', 'Parent / guardian', 'Guardian phone', 'Status', ''], rows, 'No students match this search.') + C.truncatedNote(d.truncated, 'student'))}`;
}

export function bindDirectory(kind) {
  C.bindSearch(kind, q => { C.state.search[kind] = q; C.render(kind, { silent: true }); });
  if (kind === 'students') {
    const sel = document.getElementById('studentStatusFilter');
    if (sel) { sel.value = C.state.studentStatusFilter; sel.onchange = () => { C.state.studentStatusFilter = sel.value; C.render('students'); }; }
    document.querySelectorAll('[data-status-student-user]').forEach(b => b.onclick = async () => {
      // The status screen works on the student record id; the directory lists user ids.
      try { const p = await getProfile(Number(b.dataset.statusStudentUser)); C.studentStatusModal(p.student.student_id, b.dataset.statusCurrent, b.dataset.statusName); } catch (e) { C.toast(e.message, 'error'); }
    });
  }
  bindOpenPerson(kind);
}

export function bindOpenPerson(backTo) {
  document.querySelectorAll('[data-open-person]').forEach(b => b.onclick = () => openPerson(Number(b.dataset.openPerson), backTo));
}
export function openPerson(userId, backTo) {
  C.state.personId = userId; C.state.personBack = backTo || 'dashboard';
  C.render('person');
}

// -------------------------------------------------------------------- profile
export async function loadPerson() {
  C.state.person = await getProfile(C.state.personId);
}

const fmt = v => C.fmtDate(v);
function info(label, valueHtml) { return `<div class="info-item"><label>${C.esc(label)}</label><p>${valueHtml}</p></div>`; }

export function renderPerson() {
  const p = C.state.person;
  if (!p) return '<div class="portal-empty">Profile not available.</div>';
  const u = p.user;
  const back = `<button class="btn btn-secondary btn-auto no-print" id="personBack">${C.ic('arrowleft', 15)} Back</button>`;
  const isStudent = u.role === 'student';
  const contactPhone = isStudent ? p.student?.parent_phone : u.phone;
  const contactCard = C.card('How to reach them', `<div class="portal-form-grid">
      ${isStudent ? info('Parent / guardian', C.esc(p.student?.parent_name || '—')) : ''}
      ${info(isStudent ? 'Guardian phone' : 'Phone', phoneLink(contactPhone))}
      ${info('Email', mailLink(u.email))}
      ${info('Account ID', C.esc(u.user_code))}
      ${info('Last signed in', u.last_login ? fmt(u.last_login) : 'Has not signed in yet')}
      ${info('Account created', fmt(u.created_at))}
    </div>`, p.can_edit_contact ? `<button class="btn btn-secondary btn-sm" id="editContact">${C.ic('edit', 14)} Update contact details</button>` : '');

  let body = '';
  if (isStudent && p.student) {
    const s = p.student;
    const termRows = (p.terms || []).map(t => `<tr><td>${C.esc(t.term_name)}<br><small>${C.esc(t.session_name)}</small></td><td>${t.subjects}</td><td>${t.approved}</td><td>${t.awaiting}</td><td>${t.average === null ? '—' : `${t.average}%`}</td></tr>`).join('');
    const reqRows = (p.requests || []).map(r => `<tr><td>${C.esc(describeRequest(r))}</td><td>${statusBadge(r.status)}</td><td>${fmt(r.created_at)}</td><td>${C.esc(r.review_note || '—')}</td></tr>`).join('');
    body = `${C.card('Class and status', `<div class="portal-form-grid">${info('Class', `${C.esc(s.class)} ${C.esc(s.arm)}`)}${info('Track', C.esc(s.track))}${info('Status', `<span class="portal-badge ${s.status === 'active' ? 'ok' : 'pending'}">${C.esc(s.status)}</span>${s.status_reason ? ` <small>${C.esc(s.status_reason)}</small>` : ''}`)}${info('Admission no.', C.esc(s.admission_no || '—'))}${info('Boarder', s.is_boarder ? 'Yes' : 'No')}</div>`)}
      ${C.card('Subjects this session', (p.subjects || []).length ? `<div class="chip-row">${p.subjects.map(x => `<span class="portal-badge">${C.esc(x.subject_name)}</span>`).join('')}</div>` : '<div class="portal-empty">No subjects enrolled this session.</div>')}
      ${C.card('Results by term', C.table(['Term', 'Subjects', 'Approved', 'Awaiting approval', 'Average (approved)'], termRows, 'No results have been entered for this student yet.'))}
      ${C.card('Change requests', C.table(['Request', 'Status', 'Sent', 'Reviewer note'], reqRows, 'This student has not sent any change requests.'))}
      ${p.attendance ? C.card('Attendance', `<div class="portal-grid">${C.stat('Days recorded', p.attendance.days, 'calendar')}${C.stat('Present', p.attendance.present, 'checkcircle')}${C.stat('Absent', p.attendance.absent, 'xcircle')}${C.stat('Late', p.attendance.late, 'clock')}</div>`) : ''}`;
  }
  if (u.role === 'teacher' && p.teacher) {
    const t = p.teacher;
    const asRows = (p.assignments || []).map(a => `<tr><td>${C.esc(a.class)} ${C.esc(a.arm)}</td><td>${C.esc(a.subject_name)}</td><td>${a.students}</td></tr>`).join('');
    const sheetRows = (p.sheets || []).map(x => `<tr><td>${C.esc(x.class)} ${C.esc(x.arm)} · ${C.esc(x.subject_name)}</td><td>${C.esc(x.term_name)}<br><small>${C.esc(x.session_name)}</small></td><td>${x.entered}</td><td>${x.approved}</td><td>${x.pending}</td><td>${x.rejected}</td><td>${fmt(x.last_update)}</td></tr>`).join('');
    body = `${C.card('Teaching', `<div class="portal-form-grid">${info('Department', C.esc(t.department || '—'))}${info('Staff no.', C.esc(t.staff_no || '—'))}${info('Joined', t.date_joined ? fmt(t.date_joined) : '—')}</div><h4 class="card-subhead">Subjects</h4>${(p.subjects || []).length ? `<div class="chip-row">${p.subjects.map(x => `<span class="portal-badge">${C.esc(x.subject_name)}</span>`).join('')}</div>` : '<div class="portal-empty">No subjects on record.</div>'}`)}
      ${C.card('Classes this session', C.table(['Class', 'Subject', 'Students'], asRows, 'No class assignments this session.'))}
      ${C.card('Score sheets entered', C.table(['Sheet', 'Term', 'Entered', 'Approved', 'Waiting', 'Sent back', 'Last change'], sheetRows, 'This teacher has not entered any scores yet.'))}`;
  }
  const act = (p.activity || []).map(a => `<div class="portal-kpi"><span>${C.esc(actionLabel(a.action))}${a.by_them ? '' : a.actor_name ? ` <small>by ${C.esc(a.actor_name)}</small>` : ''}<br><small>${a.by_them ? 'Done by this person · ' : ''}${fmt(a.logged_at)}</small></span></div>`).join('');
  return `<div class="portal-toolbar"><div class="profile-head"><div class="avatar avatar-lg">${C.esc(C.initials(u.full_name))}</div><div><div class="eyebrow">${C.esc(ROLE_LABEL[u.role] || u.role)}</div><h1>${C.esc(u.full_name)}</h1><p>${C.esc(u.user_code)}${u.is_active ? '' : ' · access removed'}</p></div></div>${back}</div>
    ${contactCard}${body}
    ${C.card('Recent activity', act || '<div class="portal-empty">No recorded activity yet.</div>')}`;
}

const STATUS = { pending: ['Waiting', 'pending'], approved: ['Accepted', 'ok'], declined: ['Declined', 'danger'], cancelled: ['Withdrawn', ''] };
export const statusBadge = s => { const [l, c] = STATUS[s] || [s, '']; return `<span class="portal-badge ${c}">${C.esc(l)}</span>`; };
export function describeRequest(r) {
  if (r.request_type === 'arm') return `Move to ${r.target_arm || 'another arm'}`;
  if (r.request_type === 'subject_add') return `Add ${r.subject_name || 'a subject'}`;
  return `Drop ${r.subject_name || 'a subject'}`;
}

export function bindPerson() {
  const p = C.state.person;
  document.getElementById('personBack').onclick = () => C.render(C.state.personBack || 'dashboard');
  document.getElementById('editContact')?.addEventListener('click', () => contactModal(p));
}

function contactModal(p) {
  const u = p.user, isStudent = u.role === 'student';
  C.openModal(`Contact details: ${u.full_name}`, `<div class="portal-form-grid">
    ${isStudent ? `<div class="form-group full"><label for="cName">Parent or guardian's name *</label><input id="cName" maxlength="120" value="${C.esc(p.student?.parent_name || '')}"></div>
    <div class="form-group full"><label for="cPhone">Parent or guardian's phone *</label><input id="cPhone" type="tel" inputmode="tel" maxlength="24" value="${C.esc(p.student?.parent_phone || '')}" placeholder="e.g. 0801 234 5678"></div>`
      : `<div class="form-group full"><label for="cPhone">Phone number *</label><input id="cPhone" type="tel" inputmode="tel" maxlength="24" value="${C.esc(u.phone || '')}" placeholder="e.g. 0801 234 5678"></div>`}
    <div class="form-group full"><label for="cEmail">Email</label><input id="cEmail" type="email" maxlength="120" value="${C.esc(u.email || '')}"></div>
    <div class="full"><button class="btn btn-primary" id="saveContact">Save contact details</button></div></div>`);
  document.getElementById('saveContact').onclick = async () => {
    const body = { email: document.getElementById('cEmail').value.trim() || null };
    const phone = document.getElementById('cPhone').value.trim();
    if (!phone) return C.toast(isStudent ? "Enter the parent or guardian's phone number." : 'Enter a phone number.', 'error');
    if (isStudent) { body.parent_phone = phone; body.parent_name = document.getElementById('cName').value.trim(); if (!body.parent_name) return C.toast("Enter the parent or guardian's name.", 'error'); } else body.phone = phone;
    try { await updateContact(u.id, body); C.closeModal(); C.toast('Contact details updated.', 'success'); C.render('person'); }
    catch (e) { C.toast(e.message, 'error'); }
  };
}
