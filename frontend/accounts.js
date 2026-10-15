// NNSS Calabar - "Create portal account" form.
//
// Every account needs a way for the school to reach the person: a student's
// parent or guardian, or the staff member themselves. A teacher is created with
// one or many subjects, and either every class that studies those subjects or a
// specific list of class + arm pairs.
import { createUser } from './api.js';

let C = null;
export function init(ctx) { C = ctx; }

const STAFF = ['teacher', 'hod', 'admin', 'commandant', 'editor'];

export async function openUserModal() {
  const m = await C.loadMeta();
  const isCmd = C.state.user.role === 'commandant';
  const opt = (v, t) => `<option value="${C.esc(v)}">${C.esc(t)}</option>`;
  const classOpts = m.classes.map(x => opt(x.level_name, x.level_name)).join('');
  const armOpts = m.arms.map(x => opt(x.arm_name, `${x.arm_name} (${x.arm_type})`)).join('');
  const deptOpts = m.departments.map(x => `<option value="${x.id}">${C.esc(x.dept_name)}</option>`).join('');
  const subjectBoxes = m.subjects.map(x => `<label class="check-item" data-subject-label="${C.esc(x.subject_name.toLowerCase())}"><input type="checkbox" class="u-subject" value="${C.esc(x.subject_name)}"> ${C.esc(x.subject_name)}</label>`).join('');
  const roles = [['student', 'Student'], ['teacher', 'Teacher'], ['hod', 'Head of Department'], ['editor', 'News team (blog & newsletter)']];
  if (isCmd) roles.push(['admin', 'Administrator'], ['commandant', 'Commandant']);

  C.openModal('Create portal account', `<div class="portal-form-grid">
    <div class="form-group"><label for="uRole">Role *</label><select id="uRole">${roles.map(([v, t]) => opt(v, t)).join('')}</select></div>
    <div class="form-group"><label for="uCode">User ID *</label><input id="uCode" maxlength="20" placeholder="e.g. STU004"></div>
    <div class="form-group full"><label for="uName">Full name *</label><input id="uName" maxlength="120"></div>
    ${C.pwdField('uPass', 'Initial password * (min. 8 characters)', 'new-password', 'minlength="8"')}
    <div class="form-group"><label for="uGender">Gender</label><select id="uGender"><option value="">Not specified</option><option value="M">Male</option><option value="F">Female</option></select></div>

    <div id="staffContact" class="full" hidden><div class="portal-form-grid">
      <div class="form-group"><label for="uPhone">Phone number *</label><input id="uPhone" type="tel" inputmode="tel" maxlength="24" placeholder="e.g. 0801 234 5678"><small class="field-help">The school uses this to reach them.</small></div>
      <div class="form-group"><label for="uEmail">Email</label><input id="uEmail" type="email" maxlength="120"></div></div></div>

    <div id="studentFields" class="full"><div class="portal-form-grid">
      <div class="form-group"><label for="uClass">Class *</label><select id="uClass">${classOpts}</select></div>
      <div class="form-group"><label for="uArm">Arm *</label><select id="uArm">${armOpts}</select></div>
      <div class="form-group"><label for="uTrack">Track</label><select id="uTrack" disabled><option>junior</option><option>science</option><option>technical</option><option>arts</option></select><small class="field-help">Set automatically from the class and arm.</small></div>
      <div class="form-group"><label for="uAdmission">Admission no.</label><input id="uAdmission" maxlength="20"></div>
      <div class="form-group"><label for="uParentName">Parent / guardian name *</label><input id="uParentName" maxlength="120"></div>
      <div class="form-group"><label for="uParentPhone">Parent / guardian phone *</label><input id="uParentPhone" type="tel" inputmode="tel" maxlength="24" placeholder="e.g. 0801 234 5678"></div>
      <div class="form-group full"><label for="uStudentEmail">Email (optional)</label><input id="uStudentEmail" type="email" maxlength="120"></div></div></div>

    <div id="deptField" class="form-group full" hidden><label for="uDept">Department *</label><select id="uDept">${deptOpts}</select></div>

    <div id="teacherFields" class="full" hidden><div class="portal-form-grid">
      <div class="form-group full"><label>Subjects taught * <small>(tick one or more)</small></label>
        <input type="search" id="uSubjectFilter" placeholder="Filter subjects…" aria-label="Filter subjects">
        <div class="check-grid" id="uSubjects">${subjectBoxes || '<p class="field-help">No subjects are set up yet.</p>'}</div>
        <small class="field-help" id="uSubjectCount">No subject chosen yet.</small></div>
      <div class="form-group full"><label>Which classes?</label>
        <label class="check-item"><input type="radio" name="uScope" value="all" checked> All classes and arms that study the chosen subject(s)</label>
        <label class="check-item"><input type="radio" name="uScope" value="specific"> Only the classes I pick below</label></div>
      <div id="uSpecific" class="full" hidden>
        <div class="assign-builder">
          <select id="uAsSubject" aria-label="Subject"></select>
          <select id="uAsClass" aria-label="Class">${classOpts}</select>
          <select id="uAsArm" aria-label="Arm">${armOpts}</select>
          <button type="button" class="btn btn-secondary btn-sm" id="uAsAdd">${C.ic('plus', 14)} Add</button></div>
        <div class="chip-row" id="uAsList" style="margin-top:.6rem"></div>
        <small class="field-help">A subject can only be given to a class and arm that study it. You can change this later under Teaching Assignments.</small></div>
    </div></div>

    <div class="full"><button class="btn btn-primary" id="createAccount">Create account</button></div></div>`);

  const $ = id => document.getElementById(id);
  const role = $('uRole');
  const assignments = [];
  const chosenSubjects = () => [...document.querySelectorAll('.u-subject:checked')].map(x => x.value);

  const trackSync = () => {
    const level = m.classes.find(c => c.level_name === $('uClass').value), arm = m.arms.find(a => a.arm_name === $('uArm').value);
    $('uTrack').value = level?.is_junior ? 'junior' : (arm?.arm_type || 'junior');
  };
  const drawAssignments = () => {
    $('uAsList').innerHTML = assignments.length ? assignments.map((a, i) => `<span class="portal-badge ok">${C.esc(a.subject)} · ${C.esc(a.class_level)} ${C.esc(a.arm)} <button type="button" class="chip-x" data-rm-assign="${i}" aria-label="Remove">${C.ic('x', 11)}</button></span>`).join('') : '<span class="field-help">No class added yet.</span>';
    $('uAsList').querySelectorAll('[data-rm-assign]').forEach(b => b.onclick = () => { assignments.splice(Number(b.dataset.rmAssign), 1); drawAssignments(); });
  };
  const subjectSync = () => {
    const chosen = chosenSubjects();
    $('uSubjectCount').textContent = chosen.length ? `${chosen.length} subject${chosen.length === 1 ? '' : 's'} chosen.` : 'No subject chosen yet.';
    $('uAsSubject').innerHTML = chosen.map(s => opt(s, s)).join('') || '<option value="">Choose subjects first</option>';
    for (let i = assignments.length - 1; i >= 0; i--) if (!chosen.includes(assignments[i].subject)) assignments.splice(i, 1);
    drawAssignments();
  };
  const sync = () => {
    const r = role.value;
    $('studentFields').hidden = r !== 'student';
    $('staffContact').hidden = !STAFF.includes(r);
    $('deptField').hidden = !['teacher', 'hod'].includes(r);
    $('teacherFields').hidden = r !== 'teacher';
  };
  role.onchange = sync; sync();
  $('uClass').onchange = trackSync; $('uArm').onchange = trackSync; trackSync();
  $('uSubjects').onchange = subjectSync;
  $('uSubjectFilter').oninput = e => { const q = e.target.value.trim().toLowerCase(); document.querySelectorAll('[data-subject-label]').forEach(l => { l.hidden = !!q && !l.dataset.subjectLabel.includes(q); }); };
  document.querySelectorAll('input[name="uScope"]').forEach(r => r.onchange = () => { $('uSpecific').hidden = document.querySelector('input[name="uScope"]:checked').value !== 'specific'; });
  $('uAsAdd').onclick = () => {
    const a = { subject: $('uAsSubject').value, class_level: $('uAsClass').value, arm: $('uAsArm').value };
    if (!a.subject) return C.toast('Choose the subjects first.', 'error');
    if (assignments.some(x => x.subject === a.subject && x.class_level === a.class_level && x.arm === a.arm)) return C.toast('That class is already added.', 'error');
    assignments.push(a); drawAssignments();
  };
  drawAssignments(); subjectSync();

  $('createAccount').onclick = async () => {
    const r = role.value;
    const payload = { user_code: $('uCode').value.trim().toUpperCase(), password: $('uPass').value, full_name: $('uName').value.trim(), gender: $('uGender').value || null, role: r };
    if (!payload.user_code || !payload.password || !payload.full_name) return C.toast('Fill in the role, user ID, full name and password.', 'error');
    if (payload.password.length < 8) return C.toast('The password must be at least 8 characters.', 'error');
    if (r === 'student') {
      Object.assign(payload, { class_level: $('uClass').value, arm: $('uArm').value, track: $('uTrack').value, admission_no: $('uAdmission').value.trim() || null, parent_name: $('uParentName').value.trim(), parent_phone: $('uParentPhone').value.trim(), email: $('uStudentEmail').value.trim() || null });
      if (!payload.parent_name || !payload.parent_phone) return C.toast("Enter the parent or guardian's name and phone number.", 'error');
    } else {
      payload.phone = $('uPhone').value.trim(); payload.email = $('uEmail').value.trim() || null;
      if (!payload.phone) return C.toast('Enter a phone number so the school can reach this person.', 'error');
    }
    if (['teacher', 'hod'].includes(r)) payload.department_id = Number($('uDept').value);
    if (r === 'teacher') {
      payload.subjects = chosenSubjects();
      if (!payload.subjects.length) return C.toast('Tick at least one subject for the teacher.', 'error');
      payload.assignment_mode = document.querySelector('input[name="uScope"]:checked').value;
      if (payload.assignment_mode === 'specific') {
        if (!assignments.length) return C.toast('Add at least one class, or choose "All classes".', 'error');
        payload.assignments = assignments.map(a => ({ ...a }));
      }
    }
    const btn = $('createAccount'); btn.disabled = true;
    try { await createUser(payload); C.closeModal(); C.toast('Account created successfully.', 'success'); C.state.accounts = []; C.render('accounts'); }
    catch (e) { C.toast(e.message, 'error'); btn.disabled = false; }
  };
}
