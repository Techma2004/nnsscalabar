import { getAssignmentMeta, getTeacherAssignments, updateTeacherAssignments } from './api.js';

const A = { meta:null, teacher:null, subjects:[], assignments:[] };
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const $ = s => document.querySelector(s);
const toast = (m,t='info') => window.showToast?.(m,t);

function assignmentPanel() {
  const teachers=A.meta?.teachers||[];
  const subjects=A.meta?.subjects||[];
  const classes=A.meta?.classes||[];
  const arms=A.meta?.arms||[];
  const teacherOptions=teachers.map(t=>`<option value="${t.teacher_id}">${esc(t.full_name)} · ${esc(t.department||'')}</option>`).join('');
  const subjectOptions=subjects.map(s=>`<option value="${s.id}">${esc(s.subject_name)}</option>`).join('');
  const classOptions=classes.map(c=>`<option value="${c.id}">${esc(c.level_name)}</option>`).join('');
  const armOptions=arms.map(a=>`<option value="${a.id}">${esc(a.arm_name)} · ${esc(a.category||a.arm_type||'')}</option>`).join('');
  const chips=A.assignments.map((x,i)=>`<span class="portal-badge ok" data-assignment-chip="${i}">${esc(x.subject_name)} · ${esc(x.level_name)} ${esc(x.arm_name)} <button type="button" data-remove-assignment="${i}" aria-label="Remove assignment">×</button></span>`).join('');
  const subjectChips=A.subjects.map((s,i)=>`<span class="portal-badge" data-subject-chip="${i}">${esc(s.subject_name)} <button type="button" data-remove-subject="${i}" aria-label="Remove subject">×</button></span>`).join('');
  return `<div class="portal-toolbar"><div><div class="eyebrow">Teaching workload</div><h1>Teaching Assignments</h1><p>Set exactly which subjects and class/arm combinations a teacher is responsible for in ${esc(A.meta?.session?.session_name||'the current session')}.</p></div></div>
  <section class="portal-card"><div class="portal-card-head"><h3>Teacher</h3></div><div class="portal-card-body"><div class="portal-form-grid"><div class="form-group full"><label for="assignmentTeacher">Teacher</label><select id="assignmentTeacher"><option value="">Select a teacher</option>${teacherOptions}</select></div></div><div id="assignmentEditor" class="assignment-editor" style="display:none;margin-top:1rem"></div></div></section>
  <section class="portal-card" id="assignmentHelp"><div class="portal-card-body"><p><strong>How it works:</strong> select a teacher, add one or more subjects, then add as many class/arm assignments as needed. Saving replaces only that teacher's assignments for the current academic session.</p></div></section>`;
}

function editor() {
  const subjects=A.meta.subjects||[], classes=A.meta.classes||[], arms=A.meta.arms||[];
  $('#assignmentEditor').style.display='block';
  $('#assignmentEditor').innerHTML=`<div class="portal-kpi"><span>Teacher</span><strong>${esc(A.teacher?.full_name)} · ${esc(A.teacher?.department||'')}</strong></div>
  <div class="form-group" style="margin-top:1rem"><label>Subjects</label><div class="portal-actions" id="selectedSubjects">${A.subjects.length?A.subjects.map((s,i)=>`<span class="portal-badge">${esc(s.subject_name)} <button type="button" data-remove-subject="${i}" aria-label="Remove subject">×</button></span>`).join(''):'<span class="portal-badge pending">No subjects selected</span>'}</div></div>
  <div class="portal-form-grid" style="margin-top:1rem"><div class="form-group"><label for="assignmentSubject">Subject</label><select id="assignmentSubject"><option value="">Select subject</option>${subjects.map(s=>`<option value="${s.id}">${esc(s.subject_name)}</option>`).join('')}</select></div><div class="form-group"><label for="assignmentClass">Class</label><select id="assignmentClass"><option value="">Select class</option>${classes.map(c=>`<option value="${c.id}">${esc(c.level_name)}</option>`).join('')}</select></div><div class="form-group"><label for="assignmentArm">Arm</label><select id="assignmentArm"><option value="">Select arm</option>${arms.map(a=>`<option value="${a.id}">${esc(a.arm_name)} · ${esc(a.category||a.arm_type||'')}</option>`).join('')}</select></div><div class="form-group" style="align-self:end"><button type="button" class="btn btn-secondary" id="addAssignment">Add assignment</button></div></div>
  <div class="form-group" style="margin-top:1rem"><label>Current class/arm assignments</label><div class="portal-actions" id="selectedAssignments">${A.assignments.length?A.assignments.map((x,i)=>`<span class="portal-badge ok">${esc(x.subject_name)} · ${esc(x.level_name)} ${esc(x.arm_name)} <button type="button" data-remove-assignment="${i}" aria-label="Remove assignment">×</button></span>`).join(''):'<span class="portal-badge pending">No class/arm assignments selected</span>'}</div></div>
  <div class="portal-actions" style="margin-top:1.2rem"><button type="button" class="btn btn-primary" id="saveAssignments">Save assignments</button><button type="button" class="btn btn-secondary" id="reloadAssignments">Reload current</button></div>`;
  document.querySelectorAll('[data-remove-subject]').forEach(b=>b.onclick=()=>{A.subjects.splice(Number(b.dataset.removeSubject),1);editor();});
  document.querySelectorAll('[data-remove-assignment]').forEach(b=>b.onclick=()=>{A.assignments.splice(Number(b.dataset.removeAssignment),1);editor();});
  $('#addAssignment').onclick=()=>{const subjectId=Number($('#assignmentSubject').value),classId=Number($('#assignmentClass').value),armId=Number($('#assignmentArm').value);if(!subjectId||!classId||!armId)return toast('Select a subject, class and arm.','error');const subject=subjects.find(s=>s.id===subjectId),cl=classes.find(c=>c.id===classId),arm=arms.find(a=>a.id===armId);if(A.assignments.some(x=>x.subject_id===subjectId&&x.class_level_id===classId&&x.arm_id===armId))return toast('That assignment is already listed.','warning');if(!A.subjects.some(s=>s.id===subjectId))A.subjects.push(subject);A.assignments.push({subject_id:subjectId,class_level_id:classId,arm_id:armId,subject_name:subject.subject_name,level_name:cl.level_name,arm_name:arm.arm_name});editor();};
  $('#saveAssignments').onclick=async()=>{const btn=$('#saveAssignments');btn.disabled=true;try{const out=await updateTeacherAssignments(A.teacher.teacher_id,{subject_ids:A.subjects.map(s=>s.id),assignments:A.assignments.map(x=>({subject_id:x.subject_id,class_level_id:x.class_level_id,arm_id:x.arm_id}))});toast(out.message||'Teaching assignments updated.','success');await loadTeacher(A.teacher.teacher_id);}catch(e){toast(e.message,'error');}finally{btn.disabled=false;}};
  $('#reloadAssignments').onclick=()=>loadTeacher(A.teacher.teacher_id);
}

async function loadTeacher(id){try{const data=await getTeacherAssignments(id);A.teacher=data.teacher;A.subjects=data.subjects||[];A.assignments=(data.assignments||[]).map(x=>({...x}));editor();}catch(e){toast(e.message,'error');}}

async function openAssignments(){
  try{A.meta=await getAssignmentMeta();A.teacher=null;A.subjects=[];A.assignments=[];$('#appRoot').innerHTML=assignmentPanel();document.querySelectorAll('#assignmentTeacher').forEach(s=>s.onchange=()=>{const id=Number(s.value);if(id)loadTeacher(id);});}
  catch(e){$('#appRoot').innerHTML=`<div class="portal-card"><div class="portal-empty"><h3>Teaching assignments unavailable</h3><p>${esc(e.message)}</p></div></div>`;}
}

function installNav(){
  const nav=$('#sidebarNav');
  if(!nav||nav.querySelector('[data-assignment-panel]'))return;
  const role=JSON.parse(sessionStorage.getItem('nnss_user')||'null')?.role;
  if(!['admin','commandant','hod'].includes(role))return;
  const a=document.createElement('a');a.href='#assignments';a.dataset.assignmentPanel='1';a.innerHTML='<span class="icon">▦</span>Teaching Assignments';
  a.onclick=e=>{e.preventDefault();nav.querySelectorAll('a').forEach(x=>x.classList.remove('active'));a.classList.add('active');$('#sidebar')?.classList.remove('open');$('#sidebarOverlay')?.classList.remove('active');openAssignments();};
  nav.appendChild(a);
}

const observer=new MutationObserver(installNav);
observer.observe(document.body,{childList:true,subtree:true});
document.addEventListener('DOMContentLoaded',installNav);
