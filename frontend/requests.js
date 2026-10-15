// NNSS Calabar - change requests.
//
//   Student   asks to move to another arm, or to add / drop a subject, and sees
//             what happened to each request.
//   HOD / Admin / Commandant  review the queue and accept or decline.
import { getRequestOptions, getMyRequests, createRequest, cancelRequest, getReviewQueue, decideRequest } from './api.js';
import { statusBadge, describeRequest, openPerson } from './people.js';

let C = null;
export function init(ctx) { C = ctx; }

const TYPE_HELP = {
  arm: 'Move to a different arm in your class. Your HOD decides.',
  subject_add: 'Take a subject you are not taking now.',
  subject_drop: 'Stop taking a subject you are taking now.'
};

// ---------------------------------------------------------------- student side
export async function loadStudent() {
  const [options, mine] = await Promise.all([getRequestOptions(), getMyRequests()]);
  C.state.reqOptions = options; C.state.myRequests = mine.rows;
}

export function renderStudent() {
  const o = C.state.reqOptions || { arms: [], subjects: [], enrolled: [] };
  const enrolled = new Set(o.enrolled || []);
  const armOpts = o.arms.map(a => `<option value="${a.id}">${C.esc(a.arm_name)}${a.category ? ` · ${C.esc(a.category)}` : ''}</option>`).join('');
  const rows = (C.state.myRequests || []).map(r => `<tr><td><strong>${C.esc(describeRequest(r))}</strong><br><small>${C.esc(r.reason)}</small></td><td>${statusBadge(r.status)}</td><td>${C.fmtDate(r.created_at)}</td><td>${C.esc(r.review_note || (r.status === 'pending' ? 'Waiting for your HOD' : '—'))}${r.reviewed_by_name ? `<br><small>${C.esc(r.reviewed_by_name)}</small>` : ''}</td><td>${r.status === 'pending' ? `<button class="btn btn-secondary btn-sm" data-cancel-request="${r.id}">Withdraw</button>` : ''}</td></tr>`).join('');
  const form = `<div class="portal-form-grid">
      <div class="form-group full"><label for="reqType">What do you want to change?</label><select id="reqType"><option value="arm">Change my arm</option><option value="subject_add">Add a subject</option><option value="subject_drop">Drop a subject</option></select><small id="reqHelp" class="field-help">${C.esc(TYPE_HELP.arm)}</small></div>
      <div class="form-group full" id="reqArmRow"><label for="reqArm">New arm</label><select id="reqArm"><option value="">Choose an arm…</option>${armOpts}</select></div>
      <div class="form-group full" id="reqSubjectRow" hidden><label for="reqSubject">Subject</label><select id="reqSubject"></select></div>
      <div class="form-group full"><label for="reqReason">Why? *</label><textarea id="reqReason" rows="3" maxlength="500" placeholder="A sentence or two for your HOD"></textarea></div>
      <div class="full"><button class="btn btn-primary" id="sendRequest">${C.ic('send', 15)} Send request</button></div></div>`;
  return `<div class="portal-toolbar"><div><div class="eyebrow">My requests</div><h1>Change Requests</h1><p>Ask your HOD to change your arm, or to add or drop a subject. Nothing changes until your HOD accepts.</p></div></div>
    ${C.card('New request', form)}
    ${C.card('My requests', C.table(['Request', 'Status', 'Sent', 'Reply', ''], rows, 'You have not sent any requests yet.'))}`;
}

export function bindStudent() {
  const o = C.state.reqOptions || { subjects: [], enrolled: [] };
  const enrolled = new Set(o.enrolled || []);
  const type = document.getElementById('reqType');
  const sync = () => {
    const t = type.value;
    document.getElementById('reqHelp').textContent = TYPE_HELP[t];
    document.getElementById('reqArmRow').hidden = t !== 'arm';
    document.getElementById('reqSubjectRow').hidden = t === 'arm';
    if (t !== 'arm') {
      const list = o.subjects.filter(s => (t === 'subject_drop' ? enrolled.has(s.id) : !enrolled.has(s.id)));
      document.getElementById('reqSubject').innerHTML = list.length ? `<option value="">Choose a subject…</option>${list.map(s => `<option value="${s.id}">${C.esc(s.subject_name)}${s.dept_name ? ` · ${C.esc(s.dept_name)}` : ''}</option>`).join('')}` : `<option value="">${t === 'subject_drop' ? 'You are not enrolled in any subject yet' : 'No other subjects to add'}</option>`;
    }
  };
  type.onchange = sync; sync();
  document.getElementById('sendRequest').onclick = async () => {
    const t = type.value, reason = document.getElementById('reqReason').value.trim();
    const body = { request_type: t, reason };
    if (t === 'arm') { body.target_arm_id = Number(document.getElementById('reqArm').value) || null; if (!body.target_arm_id) return C.toast('Choose the arm you want to move to.', 'error'); }
    else { body.subject_id = Number(document.getElementById('reqSubject').value) || null; if (!body.subject_id) return C.toast('Choose a subject.', 'error'); }
    if (reason.length < 5) return C.toast('Tell your HOD why, in a sentence or two.', 'error');
    const btn = document.getElementById('sendRequest'); btn.disabled = true;
    try { const out = await createRequest(body); C.toast(out.message, 'success'); C.render('requests'); }
    catch (e) { C.toast(e.message, 'error'); btn.disabled = false; }
  };
  document.querySelectorAll('[data-cancel-request]').forEach(b => b.onclick = async () => {
    if (!confirm('Withdraw this request?')) return;
    try { await cancelRequest(Number(b.dataset.cancelRequest)); C.toast('Request withdrawn.', 'success'); C.render('requests'); } catch (e) { C.toast(e.message, 'error'); }
  });
}

// ----------------------------------------------------------------- reviewer side
export async function loadReview() {
  const r = await getReviewQueue(C.state.reqFilter === 'all' ? 'all' : undefined);
  C.state.reviewRows = r.rows;
}

export function renderReview() {
  const filter = C.state.reqFilter === 'all' ? 'all' : 'pending';
  const rows = (C.state.reviewRows || []).map(r => {
    const pending = r.status === 'pending';
    const what = r.request_type === 'arm' ? `Move from ${C.esc(r.current_arm)} to <strong>${C.esc(r.target_arm || '?')}</strong>` : `${r.request_type === 'subject_add' ? 'Add' : 'Drop'} <strong>${C.esc(r.subject_name || '?')}</strong>${r.dept_name ? ` <small>(${C.esc(r.dept_name)})</small>` : ''}`;
    return `<tr><td><button type="button" class="person-link" data-review-person="${C.esc(r.student_code)}" data-student-name="${C.esc(r.student_name)}"><strong>${C.esc(r.student_name)}</strong><small>${C.esc(r.student_code)} · ${C.esc(r.class)} ${C.esc(r.current_arm)}</small></button></td><td>${what}</td><td>${C.esc(r.reason)}</td><td>${C.fmtDate(r.created_at)}</td><td>${pending ? `<div class="portal-actions"><button class="btn btn-primary btn-sm" data-accept="${r.id}">Accept</button><button class="btn btn-danger btn-sm" data-decline="${r.id}">Decline</button></div>` : `${statusBadge(r.status)}<br><small>${C.esc(r.reviewed_by_name || '')}${r.review_note ? ` · ${C.esc(r.review_note)}` : ''}</small>`}</td></tr>`;
  }).join('');
  const pendingCount = (C.state.reviewRows || []).filter(r => r.status === 'pending').length;
  return `<div class="portal-toolbar"><div><div class="eyebrow">Student requests</div><h1>Change Requests</h1><p>Students ask to change arm or to add / drop a subject. Accepting makes the change straight away.</p></div>
      <select id="reqFilter" class="btn-auto" aria-label="Show"><option value="pending" ${filter === 'pending' ? 'selected' : ''}>Waiting for a decision</option><option value="all" ${filter === 'all' ? 'selected' : ''}>All requests</option></select></div>
    ${C.card(filter === 'pending' ? `Waiting for a decision (${pendingCount})` : 'All requests', C.table(['Student', 'Request', 'Reason', 'Sent', 'Decision'], rows, filter === 'pending' ? 'No requests are waiting. You are up to date.' : 'No requests yet.'))}`;
}

export function bindReview() {
  const f = document.getElementById('reqFilter');
  if (f) f.onchange = () => { C.state.reqFilter = f.value; C.render('requests'); };
  document.querySelectorAll('[data-review-person]').forEach(b => b.onclick = async () => {
    const row = C.state.reviewRows.find(r => r.student_code === b.dataset.reviewPerson);
    if (row?.student_user_id) openPerson(row.student_user_id, 'requests');
  });
  document.querySelectorAll('[data-accept]').forEach(b => b.onclick = () => decideModal(Number(b.dataset.accept), 'approved'));
  document.querySelectorAll('[data-decline]').forEach(b => b.onclick = () => decideModal(Number(b.dataset.decline), 'declined'));
}

function decideModal(id, decision) {
  const accept = decision === 'approved';
  C.openModal(accept ? 'Accept this request' : 'Decline this request', `<div class="portal-form-grid">
    <p class="full">${accept ? 'The change is made as soon as you accept.' : 'The student will see your reason.'}</p>
    <div class="form-group full"><label for="decNote">${accept ? 'Note to the student (optional)' : 'Reason *'}</label><textarea id="decNote" rows="3" maxlength="500"></textarea></div>
    <div class="full"><button class="btn ${accept ? 'btn-primary' : 'btn-danger'}" id="confirmDecision">${accept ? 'Accept request' : 'Decline request'}</button></div></div>`);
  document.getElementById('confirmDecision').onclick = async () => {
    const note = document.getElementById('decNote').value.trim();
    if (!accept && !note) return C.toast('Give a short reason so the student understands.', 'error');
    const btn = document.getElementById('confirmDecision'); btn.disabled = true;
    try { const out = await decideRequest(id, decision, note || undefined); C.closeModal(); C.toast(out.message, 'success'); C.render('requests'); }
    catch (e) { C.toast(e.message, 'error'); btn.disabled = false; }
  };
}
