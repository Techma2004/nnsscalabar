import {
  getCurrentUser, logout, getStats, getStudentSummary, getStudentResults, getStudentSubjects,
  getAllStudents, getAllTeachers, getAllUsers, getAllResults, getAdminMeta, createUser, updateUserStatus,
  getTeacherStudents, getAssignments, uploadResult, getPendingResults, approveResult, rejectResult, getRejections,
  getAnnouncements, createAnnouncement, getTopPerformers, removeUser, getAiStatus, aiImportScores,
  updateStudentStatus, getSubjects, createSubject, updateSubject, updateSubjectStatus, toggleCurriculum, createDepartment, getCurriculumHistory,
  changeMyPassword, resetUserPassword, getManagedAnnouncements, updateAnnouncement, deleteAnnouncement,
  getSessions, createSession, activateSession, createTerm, updateTerm,
  getDepartments, getDepartmentDetail, getClassesAndArms, createClassLevel, updateClassLevel, deleteClassLevel, createArm, updateArm, deleteArm, getHodSummary
} from './api.js';

const state = { user:null, stats:{}, studentSummary:{}, results:[], resultsTruncated:false, subjects:[], students:[], studentsTruncated:false, studentStatusFilter:'active', teachers:[], teachersTruncated:false, accounts:[], accountsTruncated:false, assignments:[], pending:[], rejections:[], announcements:[], manageAnnouncements:[], top:[], meta:null, curriculum:[], curriculumHistory:[], sessions:[], classesArms:{classes:[],arms:[]}, hodSummary:null, departments:[], deptDetail:null, activeDeptId:null, search:{} };
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const roleName = {student:'Student',teacher:'Subject Teacher',hod:'Head of Department',admin:'Administrator',commandant:'Commandant'};
const TRACKS = ['junior','science','technical','arts'];
const STUDENT_STATUSES = ['active','pending','withdrawn','graduated'];
const statusBadgeClass = {active:'ok', pending:'pending', withdrawn:'danger', graduated:''};
const menus = {
  student:[['Dashboard','dashboard'],['My Results','results'],['My Subjects','subjects'],['Announcements','announcements'],['My Profile','profile']],
  teacher:[['Dashboard','dashboard'],['My Department','departments'],['Score Entry','scores'],['Score-Sheet Scanner','ai-import'],['My Students','students'],['Announcements','announcements'],['My Profile','profile']],
  hod:[['Dashboard','dashboard'],['My Department','departments'],['Result Approval','approval'],['Department Teachers','teachers'],['Announcements','announcements'],['My Profile','profile']],
  admin:[['Dashboard','dashboard'],['Students','students'],['Teachers','teachers'],['Results','results'],['Departments','departments'],['Curriculum','curriculum'],['Classes & Arms','classes'],['Academic Sessions','sessions'],['Announcements','announcements'],['System','system'],['Account Management','accounts'],['My Profile','profile']],
  commandant:[['Dashboard','dashboard'],['School Overview','overview'],['Top Performers','top'],['Departments','departments'],['Curriculum','curriculum'],['Classes & Arms','classes'],['Academic Sessions','sessions'],['Announcements','announcements'],['Account Management','accounts'],['My Profile','profile']]
};
const panelIcons = {
  dashboard:'grid', results:'document', subjects:'book', announcements:'bell', profile:'user',
  scores:'pencil', 'ai-import':'cpu', students:'users', teachers:'idbadge', approval:'checksquare',
  system:'settings', accounts:'userplus', overview:'barchart', top:'trophy', curriculum:'book', sessions:'calendar', classes:'grid', departments:'shield'
};
const ic = (name,size) => (typeof window.Icon==='function') ? window.Icon(name,{size:size||18}) : '';

function toast(message,type='info') { window.showToast(message,type); }
function openModal(title, body) { $('#modalTitle').textContent=title; $('#modalBody').innerHTML=body; $('#globalModal').classList.add('active'); }
function closeModal(){ $('#globalModal').classList.remove('active'); }
function initials(name){ return String(name||'?').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase() || '?'; }
function fmtDate(v){ if(!v) return '—'; const d=new Date(v); return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('en-NG',{day:'2-digit',month:'short',year:'numeric'}); }
function gradeClass(g){ return `grade-${String(g||'')[0] || 'C'}`; }
function stat(label,value,icon){ return `<div class="portal-stat"><span class="stat-icon">${ic(icon,16)}</span><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`; }
function table(headers,rows,empty='No records found.') { return `<div class="table-wrapper"><table class="portal-table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}"><div class="portal-empty">${esc(empty)}</div></td></tr>`}</tbody></table></div>`; }
function card(title,body,actions='',cls=''){ return `<section class="portal-card ${cls}"><div class="portal-card-head"><h3>${title}</h3>${actions}</div><div class="portal-card-body">${body}</div></section>`; }

// A disapproved result previously vanished with no trace for either the
// teacher who submitted it or the student it belongs to — the HOD's approval
// queue was the only place it showed up, and only until they rejected it.
// This surfaces it as a dashboard notice for both sides of that gap.
function renderRejectionNotice(kind){
  const list = state.rejections || [];
  if(!list.length) return '';
  if(kind === 'teacher'){
    const rows = list.map(r=>`<div class="ai-note-row"><div><strong>${esc(r.student_name)}</strong> · ${esc(r.subject_name)} · ${esc(r.term_name)}, ${esc(r.session_name)}<br><small>${esc(r.rejection_note)}</small></div><button class="btn btn-secondary" data-go="scores">Fix now</button></div>`).join('');
    return card(`${ic('alerttriangle',16)} Results sent back for correction (${list.length})`, rows, '', 'portal-card-alert');
  }
  const rows = list.map(r=>`<div class="ai-note-row"><div>${esc(r.subject_name)} · ${esc(r.term_name)}, ${esc(r.session_name)}<br><small>This result is being corrected by your teacher and will be updated soon.</small></div></div>`).join('');
  return card(`${ic('alerttriangle',16)} Results under correction (${list.length})`, rows, '', 'portal-card-alert');
}
// Every password input in the portal is built through this helper so that all
// of them get a show/hide toggle — people genuinely cannot tell what they are
// typing otherwise, which is the main cause of "the password doesn't work"
// support calls when an admin is handing out credentials.
function pwdField(id,label,autocomplete='new-password',extra=''){
  return `<div class="form-group full"><label for="${id}">${esc(label)}</label><div class="password-wrap"><input id="${id}" type="password" autocomplete="${autocomplete}" ${extra}><button type="button" class="password-toggle" data-pwd-toggle="${id}" aria-label="Show password">${ic('eye',18)}</button></div></div>`;
}
// One delegated listener covers every toggle, including those inside modals
// rendered after page load.
document.addEventListener('click', e => {
  const btn = e.target.closest?.('[data-pwd-toggle]');
  if(!btn) return;
  const input = document.getElementById(btn.dataset.pwdToggle);
  if(!input) return;
  const showing = input.type === 'password';
  input.type = showing ? 'text' : 'password';
  btn.innerHTML = ic(showing ? 'eyeoff' : 'eye', 18);
  btn.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
});
function searchBox(key,placeholder){ return `<div class="portal-search"><span class="portal-search-icon">${ic('search',15)}</span><input type="search" id="search-${key}" placeholder="${esc(placeholder)}" value="${esc(state.search[key]||'')}"></div>`; }
function bindSearch(key,onSearch){
  const input=$(`#search-${key}`); if(!input) return;
  let timer;
  input.oninput=()=>{ clearTimeout(timer); timer=setTimeout(()=>{ state.search[key]=input.value.trim(); onSearch(state.search[key]); },350); };
}
function truncatedNote(truncated,label){ return truncated?`<p style="color:var(--text-secondary);font-size:.82rem;margin-top:.5rem">Showing the first matches only — refine your search to narrow the ${esc(label)} list further.</p>`:''; }

function buildNav(){
  $('#sidebarNav').innerHTML=(menus[state.user.role]||[]).map(([label,panel])=>`<a href="#${panel}" data-panel="${panel}"><span class="icon">${ic(panelIcons[panel]||'grid',17)}</span>${esc(label)}</a>`).join('');
  $('#sidebarNav').querySelectorAll('a').forEach(a=>a.addEventListener('click',e=>{e.preventDefault(); render(a.dataset.panel);}));
}
function activeNav(panel){ $('#sidebarNav').querySelectorAll('a').forEach(a=>a.classList.toggle('active',a.dataset.panel===panel)); $('#sidebar').classList.remove('open'); $('#sidebarOverlay').classList.remove('active'); }

async function init(){
  try {
    state.user=await getCurrentUser();
  } catch { location.href='login.html'; return; }
  $('#navUserBadge').textContent=`${state.user.name} · ${roleName[state.user.role]}`;
  $('#sidebarAvatar').textContent=initials(state.user.name); $('#sidebarName').textContent=state.user.name; $('#sidebarRole').textContent=roleName[state.user.role];
  buildNav();
  $('#logoutTop').onclick=signOut; $('#logoutSide').onclick=signOut; $('#modalClose').onclick=closeModal; $('#globalModal').addEventListener('click',e=>{if(e.target.id==='globalModal')closeModal();});
  $('#mobileToggle').onclick=()=>{$('#sidebar').classList.add('open');$('#sidebarOverlay').classList.add('active');}; $('#sidebarOverlay').onclick=()=>{$('#sidebar').classList.remove('open');$('#sidebarOverlay').classList.remove('active');};
  render('dashboard');
}
async function signOut(){ try{await logout();}finally{location.href='login.html';} }

async function loadCommon(){ state.stats=await getStats(); }
async function render(panel,{silent=false}={}){
  // A search keystroke used to call render() the normal way: the whole panel
  // (loading spinner included) got wiped and rebuilt, which threw focus off
  // the search box and felt like the page had reloaded. "silent" skips the
  // loading flash and restores focus/cursor afterwards, for search-driven
  // re-renders only — a real panel switch still shows the loading state.
  const focused=document.activeElement;
  const focusedId=focused && focused.id && focused.id.startsWith('search-') ? focused.id : null;
  const selStart=focusedId?focused.selectionStart:null, selEnd=focusedId?focused.selectionEnd:null;
  activeNav(panel);
  if(!silent) $('#appRoot').innerHTML='<div class="portal-loading"><span class="loading"></span><p>Loading secure portal data…</p></div>';
  try {
    if(panel==='dashboard') await loadCommon();
    if(state.user.role==='student'){
      if(panel==='results') state.results=await getStudentResults(state.user.user_code);
      if(panel==='subjects') state.subjects=await getStudentSubjects(state.user.user_code);
      if(panel==='dashboard') { state.studentSummary=await getStudentSummary(); state.rejections=await getRejections(); }
    }
    if(state.user.role==='teacher'){
      if(panel==='scores' || panel==='ai-import') { state.assignments=await getAssignments(); state.students=await getTeacherStudents(state.user.user_code); state.meta=await getAdminMeta(); }
      if(panel==='dashboard') { state.assignments=await getAssignments(); state.rejections=await getRejections(); }
      if(panel==='students') { const r=await getTeacherStudents(state.user.user_code,state.search.students); state.students=r; }
    }
    if(state.user.role==='hod'){
      if(panel==='dashboard') state.hodSummary=await getHodSummary();
      if(panel==='approval') state.pending=await getPendingResults();
    }
    if(state.user.role==='hod' && panel==='teachers') { const r=await getAllTeachers(state.search.teachers); state.teachers=r.rows; state.teachersTruncated=r.truncated; }
    if(['admin','commandant'].includes(state.user.role)){
      if(panel==='accounts') { const r=await getAllUsers(state.search.accounts); state.accounts=r.rows; state.accountsTruncated=r.truncated; }
      if(panel==='sessions') state.sessions=await getSessions();
      if(panel==='classes') state.classesArms=await getClassesAndArms();
    }
    if(state.user.role==='admin'){
      if(panel==='students') { const r=await getAllStudents(state.studentStatusFilter,state.search.students); state.students=r.rows; state.studentsTruncated=r.truncated; }
      if(panel==='teachers') { const r=await getAllTeachers(state.search.teachers); state.teachers=r.rows; state.teachersTruncated=r.truncated; }
      if(panel==='results') { const r=await getAllResults(state.search.results); state.results=r.rows; state.resultsTruncated=r.truncated; }
    }
    if(['admin','commandant'].includes(state.user.role) && panel==='curriculum'){ state.curriculum=await getSubjects(); state.curriculumHistory=await getCurriculumHistory(); await loadMeta(); }
    if(panel==='announcements'){
      state.announcements=await getAnnouncements();
      if(['admin','commandant','hod'].includes(state.user.role)) state.manageAnnouncements=await getManagedAnnouncements(state.search.announcements);
    }
    if(panel==='departments'){
      state.departments=await getDepartments();
      // Non-management staff only ever have one department, so open it directly.
      const only = state.activeDeptId || (state.departments.length===1 ? state.departments[0].id : null);
      state.deptDetail = only ? await getDepartmentDetail(only) : null;
      state.activeDeptId = only;
    }
    if(panel==='top') state.top=await getTopPerformers();
    $('#appRoot').innerHTML=renderPanel(panel);
    bindPanel(panel);
    if(focusedId){ const el=$('#'+focusedId); if(el){ el.focus(); el.setSelectionRange(selStart,selEnd); } }
  } catch(err){ console.error(err); $('#appRoot').innerHTML=`<div class="portal-card"><div class="portal-empty"><h3>We couldn't load this section</h3><p>${esc(err.message)}</p><button class="btn btn-primary" id="retryPanel">Retry</button></div></div>`; $('#retryPanel').onclick=()=>render(panel); if(err.message.toLowerCase().includes('session')) setTimeout(()=>location.href='login.html',1000); }
}
function renderPanel(panel){
  if(panel==='dashboard') return renderDashboard();
  if(panel==='results') return renderResults();
  if(panel==='subjects') return renderSubjects();
  if(panel==='announcements') return renderAnnouncements();
  if(panel==='profile') return renderProfile();
  if(panel==='scores') return renderScoreEntry();
  if(panel==='ai-import') return renderAiImport();
  if(panel==='students') return renderStudents();
  if(panel==='approval') return renderApproval();
  if(panel==='teachers') return renderTeachers();
  if(panel==='system') return renderSystem();
  if(panel==='curriculum') return renderCurriculum();
  if(panel==='sessions') return renderSessions();
  if(panel==='classes') return renderClassesArms();
  if(panel==='departments') return renderDepartments();
  if(panel==='overview') return renderOverview();
  if(panel==='top') return renderTop();
  if(panel==='accounts') return renderAccounts();
  return '<div class="portal-empty">Section not found.</div>';
}

function renderDashboard(){
  const r=state.user.role;
  if(r==='student') return `<div class="portal-toolbar"><div><div class="eyebrow">Student workspace</div><h1>Welcome, ${esc(state.user.name.split(' ')[0])}</h1><p>Your academic information at a glance.</p></div></div>
    ${renderRejectionNotice('student')}
    <div class="portal-grid">${stat('Approved subjects',state.studentSummary.subjects||0,'book')}${stat('Current average',state.studentSummary.average?`${state.studentSummary.average}%`:'—','trendingup')}${stat('Passed subjects',state.studentSummary.passes||0,'checkcircle')}${stat('Active notices',state.stats.active_announcements||0,'bell')}</div>
    ${card('Academic status',`<div class="portal-kpi"><span>Portal access</span><strong class="portal-badge ok">Active</strong></div><div class="portal-kpi"><span>Class</span><strong>${esc(state.user.class_name||'—')} ${esc(state.user.arm_name||'')}</strong></div><div class="portal-kpi"><span>Account ID</span><strong>${esc(state.user.user_code)}</strong></div>`)} `;
  // An HOD sees their own department named explicitly, with figures scoped to
  // that department, rather than school-wide counters they have to interpret.
  if(r==='hod'){
    const h=state.hodSummary;
    if(!h) return `<div class="portal-toolbar"><div><div class="eyebrow">Head of Department</div><h1>Department control centre</h1></div></div>${card('Department not assigned','<p>No department is currently assigned to your account. Please contact an administrator so your dashboard and approval queue can be scoped correctly.</p>')}`;
    return `<div class="portal-toolbar"><div><div class="eyebrow">Head of Department</div><h1>${esc(h.dept_name)}</h1><p>${esc(h.description||'Review departmental results before publication.')}</p></div><span class="portal-badge ok">${esc(h.dept_name)}</span></div>
      <div class="portal-grid">${stat('Department teachers',h.teachers,'idbadge')}${stat('Department subjects',h.subjects,'book')}${stat('Awaiting approval',h.pending_results,'clock')}${stat('Approved results',h.approved_results,'barchart')}</div>
      ${card('Approval queue',`<p>There ${h.pending_results===1?'is':'are'} <strong>${h.pending_results}</strong> result${h.pending_results===1?'':'s'} from <strong>${esc(h.dept_name)}</strong> waiting for your review.</p><button class="btn btn-primary" data-go="approval">Open approval queue ${ic('arrowright',15)}</button>`)}
      ${card('Department details',`<div class="portal-kpi"><span>Department</span><strong>${esc(h.dept_name)}</strong></div><div class="portal-kpi"><span>Appointed</span><strong>${h.appointed_date?fmtDate(h.appointed_date):'—'}</strong></div><div class="portal-kpi"><span>Account ID</span><strong>${esc(state.user.user_code)}</strong></div>`)}`;
  }
  // A teacher's dashboard reflects their own teaching load, not school-wide
  // totals they have no responsibility for (and should not see).
  if(r==='teacher'){
    // A teacher previously only saw a bare count of "my subjects" with no
    // indication of what those subjects actually were, or which class/arm
    // each is taught in — they had to open Score Entry just to check.
    const byClass=new Map();
    (state.assignments||[]).forEach(a=>{ const key=`${a.class_name} ${a.arm_name}`; if(!byClass.has(key)) byClass.set(key,new Set()); byClass.get(key).add(a.subject_name); });
    const teachingRows=[...byClass.entries()].map(([cls,subs])=>`<div class="portal-kpi"><span>${esc(cls)}</span><strong>${[...subs].map(esc).join(', ')}</strong></div>`).join('') || '<p style="color:var(--text-secondary)">No teaching assignments yet.</p>';
    return `<div class="portal-toolbar"><div><div class="eyebrow">${esc(roleName[r])}</div><h1>Teacher workspace</h1><p>Manage score entry and your assigned students.</p></div></div>
    ${renderRejectionNotice('teacher')}
    <div class="portal-grid">${stat('My students',state.stats.students??0,'users')}${stat('My subjects',state.stats.subjects??0,'book')}${stat('Awaiting approval',state.stats.pending_results??0,'clock')}${stat('Approved results',state.stats.results??0,'checkcircle')}</div>
    ${card('What I teach',teachingRows)}
    ${card('Workflow',`<div class="portal-kpi"><span>1. Select an assignment</span><strong>${ic('checksquare',16)}</strong></div><div class="portal-kpi"><span>2. Enter CA + exam</span><strong>${ic('pencil',16)}</strong></div><div class="portal-kpi"><span>3. Submit for HOD review</span><strong>${ic('checkcircle',16)}</strong></div>`)}`;
  }
  if(r==='student') return '';
  const title={admin:'Administration control centre',commandant:'Commandant overview'}[r];
  const subtitle={admin:'Manage accounts, academic records and school communications.',commandant:'Monitor school-wide academic performance and activity.'}[r];
  return `<div class="portal-toolbar"><div><div class="eyebrow">${esc(roleName[r])}</div><h1>${title}</h1><p>${subtitle}</p></div></div><div class="portal-grid">${stat('Students',state.stats.students,'users')}${stat('Teachers',state.stats.teachers,'idbadge')}${stat('Approved results',state.stats.results,'barchart')}${stat('Pending results',state.stats.pending_results,'clock')}</div>
    ${card('System status',`<div class="portal-kpi"><span>Database-backed portal</span><strong class="portal-badge ok">Online</strong></div><div class="portal-kpi"><span>Active announcements</span><strong>${state.stats.active_announcements||0}</strong></div>`)}`;
}

function renderDepartments(){
  const canSeeAll=['admin','commandant'].includes(state.user.role);
  const d=state.deptDetail;
  // Admin/commandant get an overview of every department first; staff go
  // straight into their own, since that is the only one they can access.
  const overview = canSeeAll ? `<div class="portal-grid">${state.departments.map(x=>`<div class="portal-stat" style="cursor:pointer" data-open-dept="${x.id}"><span class="stat-icon">${ic('shield',16)}</span><small>${esc(x.dept_name)}</small><strong>${x.subject_count}</strong><div style="color:var(--text-secondary);font-size:.78rem;margin-top:.35rem">${x.teacher_count} teacher${x.teacher_count===1?'':'s'}${x.pending_count?` · <span style="color:var(--warning)">${x.pending_count} pending</span>`:''}</div><div style="color:var(--text-light);font-size:.75rem;margin-top:.2rem">HOD: ${esc(x.hod_name||'Not assigned')}</div></div>`).join('')}</div>` : '';

  if(!d) return `<div class="portal-toolbar"><div><div class="eyebrow">Academic structure</div><h1>Departments</h1><p>Select a department to see its subjects, staff and performance.</p></div></div>${overview}`;

  const s=d.stats||{};
  const subjectRows=d.subjects.map(x=>`<tr><td><strong>${esc(x.subject_name)}</strong>${x.is_active?'':' <span class="portal-badge danger">Not offered</span>'}</td><td>${esc((x.tracks||[]).join(', ')||'—')}</td><td>${x.ca_max} / ${x.exam_max}</td><td>${x.result_count}</td></tr>`).join('');
  const teacherRows=d.teachers.map(x=>`<tr><td><strong>${esc(x.full_name)}</strong><br><small>${esc(x.user_code)}</small></td><td>${esc(x.subjects||'—')}</td><td>${esc(x.qualification||'—')}</td><td>${x.date_joined?fmtDate(x.date_joined):'—'}</td></tr>`).join('');
  const classRows=d.classes.map(x=>`<tr><td>${esc(x.class_name)} ${esc(x.arm_name)}</td><td>${x.student_count}</td><td>${x.avg_score!=null?`${x.avg_score}%`:'—'}</td></tr>`).join('');
  const totalGraded=d.grade_distribution.reduce((a,g)=>a+g.n,0);
  const gradeBars=totalGraded?d.grade_distribution.map(g=>`<div class="portal-kpi"><span><strong>${esc(g.grade)}</strong></span><span style="flex:1;margin:0 1rem"><span class="portal-progress"><span style="width:${Math.round(g.n/totalGraded*100)}%"></span></span></span><span>${g.n} (${Math.round(g.n/totalGraded*100)}%)</span></div>`).join(''):'<p style="color:var(--text-secondary)">No approved results yet.</p>';
  const backBtn=canSeeAll?`<button class="btn btn-secondary btn-auto" id="deptBack">All departments</button>`:'';

  return `<div class="portal-toolbar"><div><div class="eyebrow">${canSeeAll?'Department':'My department'}</div><h1>${esc(d.department.dept_name)}</h1><p>${esc(d.department.description||'Subjects, staff and performance for this department.')}</p></div>${backBtn}</div>
    ${canSeeAll?overview:''}
    <div class="portal-grid">${stat('Subjects',d.subjects.filter(x=>x.is_active).length,'book')}${stat('Teachers',d.teachers.length,'idbadge')}${stat('Awaiting approval',s.pending||0,'clock')}${stat('Department average',s.avg_score!=null?`${s.avg_score}%`:'—','trendingup')}</div>
    ${card('Subjects',table(['Subject','Curriculum tracks','CA / Exam','Results recorded'],subjectRows,'No subjects assigned to this department.'))}
    ${card('Teaching staff',table(['Teacher','Subjects','Qualification','Joined'],teacherRows,'No teachers assigned to this department.'))}
    ${card('Performance by class',table(['Class','Students','Average'],classRows,'No results recorded for this department yet.'))}
    ${card('Grade distribution (approved results)',gradeBars)}`;
}
function bindDepartments(){
  document.querySelectorAll('[data-open-dept]').forEach(el=>el.onclick=async()=>{
    state.activeDeptId=Number(el.dataset.openDept); render('departments');
  });
  $('#deptBack')?.addEventListener('click',()=>{ state.activeDeptId=null; state.deptDetail=null; render('departments'); });
}
function renderClassesArms(){
  const ARM_TYPES=['junior','science','technical','arts'];
  const classRows=state.classesArms.classes.map(c=>`<tr><td><strong>${esc(c.level_name)}</strong></td><td>${c.is_junior?'<span class="portal-badge">Junior</span>':'<span class="portal-badge">Senior</span>'}</td><td>${c.student_count}</td><td class="portal-actions"><button class="btn btn-secondary btn-sm" data-edit-class="${c.id}">Rename</button><button class="btn btn-danger btn-sm" data-delete-class="${c.id}" data-name="${esc(c.level_name)}" data-count="${c.student_count}">Delete</button></td></tr>`).join('');
  const armRows=state.classesArms.arms.map(a=>`<tr><td><strong>${esc(a.arm_name)}</strong>${a.is_active?'':' <span class="portal-badge danger">Inactive</span>'}<br><small>${esc(a.category||'—')}</small></td><td>${esc(a.arm_type)}</td><td>${a.student_count}</td><td class="portal-actions"><button class="btn btn-secondary btn-sm" data-edit-arm="${a.id}">Edit</button><button class="btn btn-sm ${a.is_active?'btn-secondary':'btn-primary'}" data-toggle-arm="${a.id}" data-active="${a.is_active?'1':'0'}">${a.is_active?'Deactivate':'Reactivate'}</button><button class="btn btn-danger btn-sm" data-delete-arm="${a.id}" data-name="${esc(a.arm_name)}" data-count="${a.student_count}">Delete</button></td></tr>`).join('');
  const addClass=`<div class="portal-form-grid"><div class="form-group"><label>Class name</label><input id="newClassName" maxlength="20" placeholder="e.g. SS4"></div><div class="form-group" style="align-self:end"><label style="display:flex;align-items:center;gap:.4rem;cursor:pointer;font-weight:500"><input type="checkbox" id="newClassJunior" style="width:auto"> Junior class (uses the junior curriculum)</label></div><div class="full"><button class="btn btn-primary" id="addClassBtn">Add class</button></div></div>`;
  const addArm=`<div class="portal-form-grid"><div class="form-group"><label>Arm name</label><input id="newArmName" maxlength="30" placeholder="e.g. OBUDU"></div><div class="form-group"><label>Track</label><select id="newArmType">${ARM_TYPES.map(t=>`<option value="${t}">${t}</option>`).join('')}</select></div><div class="form-group full"><label>Category (optional)</label><input id="newArmCategory" maxlength="50" placeholder="e.g. Senior Science"></div><div class="full"><button class="btn btn-primary" id="addArmBtn">Add arm</button></div></div>`;
  return `<div class="portal-toolbar"><div><div class="eyebrow">School structure</div><h1>Classes & Arms</h1><p>Add, rename or retire classes and arms as the school reorganises. Arms in use are deactivated rather than deleted so existing records stay intact.</p></div></div>
    ${card('Add a class',addClass)}
    ${card('Class levels',table(['Class','Level','Students','Action'],classRows,'No classes defined.'))}
    ${card('Add an arm',addArm)}
    ${card('Arms',table(['Arm','Track','Students','Action'],armRows,'No arms defined.'))}`;
}
function bindClassesArms(){
  $('#addClassBtn').onclick=async()=>{
    const level_name=$('#newClassName').value.trim();
    if(!level_name) return toast('Enter a class name.','error');
    try{ await createClassLevel({level_name,is_junior:$('#newClassJunior').checked}); toast('Class added.','success'); render('classes'); }
    catch(e){ toast(e.message,'error'); }
  };
  $('#addArmBtn').onclick=async()=>{
    const arm_name=$('#newArmName').value.trim();
    if(!arm_name) return toast('Enter an arm name.','error');
    try{ await createArm({arm_name,arm_type:$('#newArmType').value,category:$('#newArmCategory').value.trim()||null}); toast('Arm added.','success'); render('classes'); }
    catch(e){ toast(e.message,'error'); }
  };
  document.querySelectorAll('[data-edit-class]').forEach(b=>b.onclick=()=>{
    const c=state.classesArms.classes.find(x=>x.id===Number(b.dataset.editClass)); if(!c) return;
    openModal(`Rename ${esc(c.level_name)}`,`<div class="portal-form-grid"><div class="form-group full"><label>Class name</label><input id="editClassName" maxlength="20" value="${esc(c.level_name)}"></div><div class="form-group full"><label style="display:flex;align-items:center;gap:.4rem;cursor:pointer;font-weight:500"><input type="checkbox" id="editClassJunior" style="width:auto" ${c.is_junior?'checked':''}> Junior class</label></div><div class="full"><button class="btn btn-primary" id="saveClass">Save changes</button></div></div>`);
    $('#saveClass').onclick=async()=>{
      const level_name=$('#editClassName').value.trim();
      if(!level_name) return toast('Class name is required.','error');
      try{ await updateClassLevel(c.id,{level_name,is_junior:$('#editClassJunior').checked}); closeModal(); toast('Class updated.','success'); render('classes'); }
      catch(e){ toast(e.message,'error'); }
    };
  });
  document.querySelectorAll('[data-delete-class]').forEach(b=>b.onclick=async()=>{
    if(Number(b.dataset.count)>0) return toast(`${b.dataset.name} still has students. Move or withdraw them first.`,'error');
    if(!confirm(`Delete ${b.dataset.name}? This cannot be undone.`)) return;
    try{ await deleteClassLevel(Number(b.dataset.deleteClass)); toast('Class removed.','success'); render('classes'); }
    catch(e){ toast(e.message,'error'); }
  });
  document.querySelectorAll('[data-edit-arm]').forEach(b=>b.onclick=()=>{
    const a=state.classesArms.arms.find(x=>x.id===Number(b.dataset.editArm)); if(!a) return;
    const types=['junior','science','technical','arts'];
    openModal(`Edit ${esc(a.arm_name)}`,`<div class="portal-form-grid"><div class="form-group"><label>Arm name</label><input id="editArmName" maxlength="30" value="${esc(a.arm_name)}"></div><div class="form-group"><label>Track</label><select id="editArmType">${types.map(t=>`<option value="${t}" ${a.arm_type===t?'selected':''}>${t}</option>`).join('')}</select></div><div class="form-group full"><label>Category</label><input id="editArmCategory" maxlength="50" value="${esc(a.category||'')}"></div><div class="full"><button class="btn btn-primary" id="saveArm">Save changes</button></div></div>`);
    $('#saveArm').onclick=async()=>{
      const arm_name=$('#editArmName').value.trim();
      if(!arm_name) return toast('Arm name is required.','error');
      try{ await updateArm(a.id,{arm_name,arm_type:$('#editArmType').value,category:$('#editArmCategory').value.trim()||null}); closeModal(); toast('Arm updated.','success'); render('classes'); }
      catch(e){ toast(e.message,'error'); }
    };
  });
  document.querySelectorAll('[data-toggle-arm]').forEach(b=>b.onclick=async()=>{
    const makeActive=b.dataset.active!=='1';
    try{ await updateArm(Number(b.dataset.toggleArm),{is_active:makeActive}); toast(makeActive?'Arm reactivated.':'Arm deactivated — it will no longer be offered for new students.','success'); render('classes'); }
    catch(e){ toast(e.message,'error'); }
  });
  document.querySelectorAll('[data-delete-arm]').forEach(b=>b.onclick=async()=>{
    if(Number(b.dataset.count)>0) return toast(`${b.dataset.name} still has students. Deactivate it instead.`,'error');
    if(!confirm(`Delete ${b.dataset.name}? This cannot be undone.`)) return;
    try{ await deleteArm(Number(b.dataset.deleteArm)); toast('Arm removed.','success'); render('classes'); }
    catch(e){ toast(e.message,'error'); }
  });
}
function renderResults(){
  const isOwn = state.user.role==='student';
  if(isOwn) return renderReportCards();
  const rows=state.results.map((r,i)=>{
    return `<tr><td>${i+1}</td><td><strong>${esc(r.student_name)}</strong><br><small>${esc(r.student_code)}</small></td><td>${esc(r.subject_name)}</td><td>${esc(r.term_name)}<br><small>${esc(r.session_name)}</small></td><td>${r.ca_score}</td><td>${r.exam_score}</td><td><strong>${r.total_score}</strong></td><td class="${gradeClass(r.grade)}">${esc(r.grade)}</td><td>${r.is_approved?'<span class="portal-badge ok">Approved</span>':'<span class="portal-badge pending">Pending</span>'}</td></tr>`;
  }).join('');
  const headers = ['#','Student','Subject','Term','CA','Exam','Total','Grade','Status'];
  return `<div class="portal-toolbar"><div><div class="eyebrow">Academic oversight</div><h1>Results</h1><p>Every submitted result across the school, most recent first.</p></div>${searchBox('results','Search by student, code or subject…')}</div>${card('All results',table(headers,rows,'No results match this search.')+truncatedNote(state.resultsTruncated,'results'))}`;
}
// A student's own results used to be one flat admin-style table with a
// "Print" button that just ran window.print() on it — on paper it looked
// like a raw data dump, not a report card. This groups approved results by
// term/session and lays each term out as its own printable report-card
// sheet: school header, student bio, subject breakdown, summary and a
// grading key, with a page break between terms.
function renderReportCards(){
  const u=state.user;
  const groups=new Map();
  state.results.forEach(r=>{
    const key=`${r.session_name}|${r.term_name}`;
    if(!groups.has(key)) groups.set(key,{session_name:r.session_name,term_name:r.term_name,rows:[]});
    groups.get(key).rows.push(r);
  });
  const printedOn=fmtDate(new Date());
  const legend='Grading key: A1/B2/B3 Excellent–Very Good · C4/C5/C6 Credit · D7/E8 Pass · F9 Fail';
  const cards=[...groups.values()].map(g=>{
    const subjectRows=g.rows.map(r=>`<tr><td>${esc(r.subject_name)}</td><td>${r.ca_score}</td><td>${r.exam_score}</td><td><strong>${r.total_score}</strong></td><td class="${gradeClass(r.grade)}">${esc(r.grade)}</td><td>${esc(r.remark||'—')}</td></tr>`).join('');
    const count=g.rows.length;
    const average=count?(g.rows.reduce((a,r)=>a+Number(r.total_score),0)/count).toFixed(1):'0.0';
    const passes=g.rows.filter(r=>Number(r.total_score)>=50).length;
    return `<section class="report-card">
      <div class="report-card-head"><h2>NNSS Calabar</h2><p>Termly Report Card</p></div>
      <div class="report-card-bio">
        <span>Student<strong>${esc(u.name)}</strong></span>
        <span>Student ID<strong>${esc(u.user_code)}</strong></span>
        <span>Class<strong>${esc(u.class_name||'—')} ${esc(u.arm_name||'')}</strong></span>
        <span>Term<strong>${esc(g.term_name)}</strong></span>
        <span>Session<strong>${esc(g.session_name)}</strong></span>
        <span>Printed<strong>${esc(printedOn)}</strong></span>
      </div>
      ${table(['Subject','CA','Exam','Total','Grade','Remark'],subjectRows,'No approved results for this term.')}
      <div class="report-card-summary">
        <span>Subjects offered<strong>${count}</strong></span>
        <span>Average score<strong>${average}%</strong></span>
        <span>Subjects passed<strong>${passes}/${count}</strong></span>
      </div>
      <p class="report-card-legend">${esc(legend)}</p>
      <div class="report-card-signatures"><div>Class Teacher</div><div>Principal / Commandant</div></div>
    </section>`;
  }).join('') || card('Published results','<div class="portal-empty">No approved results have been published yet.</div>');
  return `<div class="portal-toolbar"><div><div class="eyebrow">Academic record</div><h1>My Results</h1><p>Only approved results are visible to students.</p></div><button class="btn btn-secondary no-print" onclick="window.print()">${ic('printer',16)}Print</button></div>${cards}`;
}
function renderSubjects(){ const rows=state.subjects.map((s,i)=>`<tr><td>${i+1}</td><td><strong>${esc(s.subject_name)}</strong></td><td>${s.ca_max}</td><td>${s.exam_max}</td><td>${s.ca_max+s.exam_max}</td></tr>`).join(''); return `<div class="portal-toolbar"><div><div class="eyebrow">Academic programme</div><h1>My Subjects</h1></div></div>${card('Enrolled subjects',table(['#','Subject','CA max','Exam max','Total'],rows,'No subjects have been enrolled for this session.'))}`; }
function renderAnnouncements(){
  const items=state.announcements.map(a=>`<article class="portal-kpi"><div><strong>${esc(a.title)}</strong><div><small>${fmtDate(a.publish_at)} · ${esc(a.type)}</small></div><p style="margin-top:.4rem">${esc(a.body)}</p></div>${a.is_pinned?'<span class="portal-badge ok">Pinned</span>':''}</article>`).join('');
  const canManage = ['admin','commandant','hod'].includes(state.user.role);
  const action=canManage?'<button class="btn btn-primary" id="newAnnouncement">+ Publish</button>':'';
  const audienceLabel = {student:'Students',teacher:'Teachers',hod:'HODs',admin:'Admins',commandant:'Commandant'};
  const manageRows = (state.manageAnnouncements||[]).map(a=>{
    const audience = String(a.audience||'').split(',').filter(Boolean).map(x=>audienceLabel[x]||x).join(', ');
    return `<tr><td><strong>${esc(a.title)}</strong><br><small>${esc((a.body||'').slice(0,80))}${(a.body||'').length>80?'…':''}</small></td><td>${esc(audience)}</td><td>${esc(a.type)}${a.is_pinned?' <span class="portal-badge ok">Pinned</span>':''}</td><td>${esc(a.author_name||'—')}</td><td>${fmtDate(a.publish_at)}${a.expires_at?`<br><small>Expires ${fmtDate(a.expires_at)}</small>`:''}</td><td class="portal-actions"><button class="btn btn-secondary btn-sm" data-edit-announcement="${a.id}">Edit</button><button class="btn btn-danger btn-sm" data-delete-announcement="${a.id}">Delete</button></td></tr>`;
  }).join('');
  const manageSection = canManage ? card('Manage announcements', table(['Announcement','Audience','Type','Author','Published','Action'], manageRows, 'No announcements match this search.'), searchBox('announcements','Search announcements…')) : '';
  return `<div class="portal-toolbar"><div><div class="eyebrow">School communication</div><h1>Announcements</h1></div>${action}</div>${card('Latest notices',items||'<div class="portal-empty">No active announcements.</div>')}${manageSection}`;
}
function bindAnnouncements(){
  $('#newAnnouncement')?.addEventListener('click',()=>announcementModal());
  bindSearch('announcements', q => { state.search.announcements=q; render('announcements',{silent:true}); });
  document.querySelectorAll('[data-edit-announcement]').forEach(b=>b.onclick=()=>{
    const a = state.manageAnnouncements.find(x=>x.id===Number(b.dataset.editAnnouncement));
    if(a) announcementModal(a);
  });
  document.querySelectorAll('[data-delete-announcement]').forEach(b=>b.onclick=async()=>{
    if(!confirm('Delete this announcement? This cannot be undone.')) return;
    try{ await deleteAnnouncement(Number(b.dataset.deleteAnnouncement)); toast('Announcement deleted.','success'); render('announcements'); }
    catch(e){ toast(e.message,'error'); }
  });
}
function announcementModal(existing){
  const isEdit = !!existing;
  const currentAudience = existing ? String(existing.audience||'').split(',').filter(Boolean) : ['student','teacher','hod','admin','commandant'];
  const options = state.user.role==='hod'
    ? [['student','Students'],['teacher','Teachers'],['hod','HODs']]
    : [['student','Students'],['teacher','Teachers'],['hod','HODs'],['admin','Admins'],['commandant','Commandant']];
  const audienceHtml = options.map(([val,label])=>`<label style="display:flex;align-items:center;gap:.4rem;font-weight:500;cursor:pointer"><input type="checkbox" class="a-audience" value="${val}" style="width:auto" ${currentAudience.includes(val)?'checked':''}> ${label}</label>`).join('');
  const expiryValue = existing?.expires_at ? new Date(existing.expires_at).toISOString().slice(0,16) : '';
  openModal(isEdit?'Edit announcement':'Publish school announcement',`<div class="portal-form-grid"><div class="form-group full"><label>Title</label><input id="aTitle" maxlength="200" value="${esc(existing?.title||'')}"></div><div class="form-group full"><label>Message</label><textarea id="aBody" rows="6">${esc(existing?.body||'')}</textarea></div><div class="form-group"><label>Type</label><select id="aType"><option value="info" ${existing?.type==='info'?'selected':''}>Information</option><option value="success" ${existing?.type==='success'?'selected':''}>Good news</option><option value="warn" ${existing?.type==='warn'?'selected':''}>Notice</option><option value="danger" ${existing?.type==='danger'?'selected':''}>Urgent</option></select></div><div class="form-group"><label>Expires (optional)</label><input id="aExpiry" type="datetime-local" value="${expiryValue}"></div><div class="form-group full"><label>Audience</label><div class="portal-actions">${audienceHtml}</div></div><div class="form-group full"><label style="display:flex;align-items:center;gap:.4rem;cursor:pointer;font-weight:500"><input type="checkbox" id="aPinned" style="width:auto" ${existing?.is_pinned?'checked':''}> Pin to top</label></div><div class="full"><button class="btn btn-primary" id="publishA">${isEdit?'Save changes':'Publish announcement'}</button></div></div>`);
  $('#publishA').onclick=async()=>{
    const title=$('#aTitle').value.trim(),body=$('#aBody').value.trim();
    const audience=[...document.querySelectorAll('.a-audience:checked')].map(el=>el.value);
    if(!title||!body)return toast('Title and message are required.','error');
    if(!audience.length) return toast('Select at least one audience.','error');
    const payload={title,body,type:$('#aType').value,expires_at:$('#aExpiry').value||null,audience,is_pinned:$('#aPinned').checked};
    try{
      if(isEdit) await updateAnnouncement(existing.id,payload); else await createAnnouncement(payload);
      closeModal();toast(isEdit?'Announcement updated.':'Announcement published.','success');render('announcements');
    }catch(e){toast(e.message,'error')}
  };
}
function renderProfile(){ return `<div class="portal-toolbar"><div><div class="eyebrow">Account</div><h1>My Profile</h1></div></div>${card('Account details',`<div class="portal-form-grid"><div class="info-item"><label>Full name</label><p>${esc(state.user.name)}</p></div><div class="info-item"><label>Role</label><p>${esc(roleName[state.user.role])}</p></div><div class="info-item"><label>User ID</label><p>${esc(state.user.user_code)}</p></div><div class="info-item"><label>Email</label><p>${esc(state.user.email||'Not provided')}</p></div></div>`)}
    ${card('Change password',`<div class="portal-form-grid">${pwdField("pwdCurrent","Current password","current-password")}${pwdField("pwdNew","New password (min. 8 characters)","new-password",'minlength="8"')}${pwdField("pwdConfirm","Confirm new password","new-password",'minlength="8"')}<div class="full"><button class="btn btn-primary" id="changePasswordBtn">Update password</button></div></div>`)}`; }
function renderScoreEntry(){
  const assignmentOptions=state.assignments.map(a=>`<option value="${a.id}" data-class="${esc(a.class_name)}" data-arm="${esc(a.arm_name)}" data-subject="${esc(a.subject_name)}" data-session="${a.session_id}" data-camax="${a.ca_max}" data-exammax="${a.exam_max}">${esc(a.class_name)} ${esc(a.arm_name)} — ${esc(a.subject_name)} (${esc(a.session_name)})</option>`).join('');
  return `<div class="portal-toolbar"><div><div class="eyebrow">Teacher workflow</div><h1>Score Entry</h1><p>Scores are validated by the server and sent to the HOD approval queue.</p></div></div>${card('Enter a result',`<div class="portal-form-grid"><div class="form-group full"><label>Teaching assignment</label><select id="scoreAssignment"><option value="">Select assignment…</option>${assignmentOptions}</select></div><div class="form-group"><label>Student</label><select id="scoreStudent"><option value="">Select assignment first…</option></select></div><div class="form-group"><label>Academic term</label><select id="scoreTerm"></select></div><div class="form-group"><label>CA score <small id="caRange">(select assignment)</small></label><input id="caScore" type="number" min="0" step="0.5" inputmode="decimal"></div><div class="form-group"><label>Exam score <small id="examRange">(select assignment)</small></label><input id="examScore" type="number" min="0" step="0.5" inputmode="decimal"></div><div class="full"><div class="portal-actions"><button class="btn btn-primary" id="saveScore">Save & submit for review</button><button class="btn btn-secondary" type="button" id="clearScore">Clear</button></div></div></div>`)}`;
}
function renderStudents(){
  const manageable = ['admin','commandant'].includes(state.user.role);
  const rows=state.students.map((s,i)=>{
    const statusCell = manageable ? `<td><span class="portal-badge ${statusBadgeClass[s.status]||''}">${esc(s.status)}</span>${s.status_reason?`<br><small>${esc(s.status_reason)}</small>`:''}</td><td><button class="btn btn-secondary btn-sm" data-status-student="${s.student_id}" data-status-name="${esc(s.full_name)}" data-status-current="${esc(s.status)}">Change status</button></td>` : '';
    return `<tr><td>${i+1}</td><td><strong>${esc(s.full_name)}</strong><br><small>${esc(s.user_code)}</small></td><td>${esc(s.class)}</td><td>${esc(s.arm)}</td><td>${esc(s.track)}</td>${statusCell}</tr>`;
  }).join('');
  const headers = manageable ? ['#','Student','Class','Arm','Track','Status','Action'] : ['#','Student','Class','Arm','Track'];
  const statusFilter = manageable ? `<select id="studentStatusFilter" class="btn-auto"><option value="active" ${state.studentStatusFilter==='active'?'selected':''}>Active</option><option value="pending" ${state.studentStatusFilter==='pending'?'selected':''}>Pending (yet to resume)</option><option value="withdrawn" ${state.studentStatusFilter==='withdrawn'?'selected':''}>Withdrawn</option><option value="graduated" ${state.studentStatusFilter==='graduated'?'selected':''}>Graduated</option><option value="all" ${state.studentStatusFilter==='all'?'selected':''}>All statuses</option></select>` : '';
  const search = searchBox('students', state.user.role==='teacher'?'Search your students…':'Search by name, code or admission no…');
  return `<div class="portal-toolbar"><div><div class="eyebrow">Student register</div><h1>${state.user.role==='teacher'?'My Students':'Students'}</h1>${manageable?'<p>Status changes preserve every academic record — nothing is deleted.</p>':''}</div><div class="portal-actions">${search}${statusFilter}</div></div>${card('Student register',table(headers,rows,'No students found for this filter.')+truncatedNote(state.studentsTruncated,'student'))}`;
}
function renderAccounts(){ const rows=state.accounts.map(a=>`<tr><td><strong>${esc(a.full_name)}</strong><br><small>${esc(a.user_code)}</small></td><td>${esc(roleName[a.role]||a.role)}</td><td>${esc(a.email||'—')}</td><td><span class="portal-badge ok">Active</span></td><td class="portal-actions">${a.user_id===state.user.id?'<span class="portal-badge">Current account</span>':`<button class="btn btn-secondary btn-sm" data-reset-password="${a.user_id}" data-reset-name="${esc(a.full_name)}">Reset password</button><button class="btn btn-danger btn-sm" data-remove-user="${a.user_id}">Remove access</button>`}</td></tr>`).join(''); return `<div class="portal-toolbar"><div><div class="eyebrow">Access control</div><h1>Account Management</h1><p>Provision and revoke portal access while preserving academic and audit history.</p></div><div class="portal-actions">${searchBox('accounts','Search accounts by name or ID…')}<button class="btn btn-primary btn-auto" id="newUser">Create account</button></div></div>${card('Active portal accounts',table(['Account','Role','Email','Status','Action'],rows,'No accounts match this search.')+truncatedNote(state.accountsTruncated,'account'))}`; }
function renderApproval(){ const rows=state.pending.map(r=>`<tr><td><strong>${esc(r.student_name)}</strong><br><small>${esc(r.student_code)}</small></td><td>${esc(r.class_name)} ${esc(r.arm_name)}</td><td>${esc(r.subject_name)}</td><td>${esc(r.term_name)}</td><td>${r.ca_score}</td><td>${r.exam_score}</td><td><strong>${r.total_score}</strong> <span class="${gradeClass(r.grade)}">${esc(r.grade)}</span></td><td><div class="portal-actions"><button class="btn btn-primary" data-approve="${r.id}">Approve</button><button class="btn btn-danger" data-reject="${r.id}">Disapprove</button></div></td></tr>`).join(''); return `<div class="portal-toolbar"><div><div class="eyebrow">Quality control</div><h1>Result Approval</h1><p>Review each submitted score before it becomes visible to students.</p></div></div>${card('Pending approval queue',table(['Student','Class','Subject','Term','CA','Exam','Total','Action'],rows,'No pending results. The department is up to date.'))}`; }
function renderTeachers(){ const rows=state.teachers.map((t,i)=>`<tr><td>${i+1}</td><td><strong>${esc(t.full_name)}</strong><br><small>${esc(t.user_code)}</small></td><td>${esc(t.department||'—')}</td><td>${esc(t.subjects||'—')}</td><td>${esc(t.email||'—')}</td></tr>`).join(''); return `<div class="portal-toolbar"><div><div class="eyebrow">Staff directory</div><h1>Teachers</h1></div>${searchBox('teachers','Search by name, ID or subject…')}</div>${card('Teaching staff',table(['#','Teacher','Department','Subjects','Email'],rows,'No teachers match this search.')+truncatedNote(state.teachersTruncated,'teacher'))}`; }
function renderSystem(){ return `<div class="portal-toolbar"><div><div class="eyebrow">Configuration</div><h1>System Administration</h1></div></div>${card('Academic configuration',`<p>Academic sessions, terms, departments, subjects and assignments are stored in the database.</p><p style="margin-top:.7rem">Use the account creation workflow to provision controlled portal access. Passwords are hashed server-side and are never returned to the browser.</p>`)}${card('Security posture',`<div class="portal-kpi"><span>Authentication</span><strong>HTTP-only session cookie</strong></div><div class="portal-kpi"><span>Role enforcement</span><strong>Server-side</strong></div><div class="portal-kpi"><span>Result publication</span><strong>HOD approval required</strong></div>`)}`; }
function renderOverview(){ return `<div class="portal-toolbar"><div><div class="eyebrow">Commandant</div><h1>School Overview</h1><p>High-level academic and operational indicators.</p></div></div><div class="portal-grid">${stat('Students',state.stats.students,'users')}${stat('Teachers',state.stats.teachers,'idbadge')}${stat('Approved results',state.stats.results,'barchart')}${stat('Pending review',state.stats.pending_results,'clock')}</div>${card('Operational picture','The dashboard is backed by live database queries rather than demo values. Use Top Performers for academic ranking and Announcements for official communications.')}`; }
function renderTop(){ const rows=state.top.map((r,i)=>`<tr><td><span class="portal-badge ${i<3?'ok':''}">#${i+1}</span></td><td><strong>${esc(r.full_name)}</strong><br><small>${esc(r.user_code)}</small></td><td>${esc(r.class)}</td><td>${esc(r.arm)}</td><td><strong>${r.avg_score}%</strong></td><td>${r.subjects_taken}</td></tr>`).join(''); return `<div class="portal-toolbar"><div><div class="eyebrow">Academic excellence</div><h1>Top Performers</h1></div></div>${card('Approved-result ranking',table(['Rank','Student','Class','Arm','Average','Subjects'],rows,'No approved results are available for ranking.'))}`; }

function renderCurriculum(){
  const depts = state.meta?.departments || [];
  const deptOpts = depts.map(d=>`<option value="${d.id}">${esc(d.dept_name)}</option>`).join('');
  const addForm = `<div class="portal-form-grid"><div class="form-group full"><label>Subject name</label><input id="newSubjectName" placeholder="e.g. Music"></div><div class="form-group"><label>Department</label><select id="newSubjectDept"><option value="">Unassigned</option>${deptOpts}</select></div><div class="form-group"><label>CA max</label><input id="newSubjectCa" type="number" min="0" max="100" value="30"></div><div class="form-group"><label>Exam max</label><input id="newSubjectExam" type="number" min="0" max="100" value="70"></div><div class="full"><button class="btn btn-primary" id="addSubjectBtn">Add subject</button></div></div>`;
  const rows = state.curriculum.map(s=>{
    const trackCells = TRACKS.map(t=>{
      const on = s.tracks.includes(t);
      return `<button class="btn btn-sm ${on?'btn-primary':'btn-secondary'}" data-track-toggle="${s.id}" data-track="${t}" data-on="${on?'1':'0'}">${t}</button>`;
    }).join(' ');
    return `<tr><td><strong>${esc(s.subject_name)}</strong><br><small>${esc(s.dept_name||'Unassigned')} · CA ${s.ca_max} / Exam ${s.exam_max}</small></td><td><span class="portal-badge ${s.is_active?'ok':'danger'}">${s.is_active?'Offered':'Not offered'}</span></td><td><div class="portal-actions">${trackCells}</div></td><td><button class="btn btn-sm ${s.is_active?'btn-danger':'btn-secondary'}" data-subject-toggle="${s.id}" data-active="${s.is_active?'1':'0'}">${s.is_active?'Stop offering':'Re-offer'}</button></td></tr>`;
  }).join('');
  // Every curriculum change (created, renamed, CA/exam split changed,
  // retired, track added/removed) is now logged server-side — this is the
  // only place that history is visible, so a change made months ago (and
  // any student results recorded under the curriculum at that time) can
  // still be traced back to who changed what and when.
  const historyRows=(state.curriculumHistory||[]).map(h=>`<div class="portal-kpi"><span>${esc(curriculumActionLabel(h))}<br><small>${esc(h.actor||'System')} · ${fmtDate(h.logged_at)}</small></span></div>`).join('') || '<p style="color:var(--text-secondary)">No curriculum changes recorded yet.</p>';
  return `<div class="portal-toolbar"><div><div class="eyebrow">Academic configuration</div><h1>Curriculum & Subjects</h1><p>Add subjects, retire ones the school no longer offers, and choose which curriculum track teaches each subject. Nothing here touches past results.</p></div></div>
    ${card('Add a subject', addForm)}
    ${card('Subjects & curriculum tracks', table(['Subject','Status','Curriculum tracks','Action'], rows, 'No subjects found.'))}
    ${card('Recent curriculum changes', historyRows)}`;
}
function curriculumActionLabel(h){
  const d=h.detail||{};
  const labels={CREATE_SUBJECT:`Added subject "${d.subject_name||''}"`,UPDATE_SUBJECT:`Edited subject #${h.entity_id}${d.after?.subject_name?` — renamed to "${d.after.subject_name}"`:''}`,DEACTIVATE_SUBJECT:`Marked "${d.subject_name||''}" as no longer offered`,REACTIVATE_SUBJECT:`Re-offered "${d.subject_name||''}"`,ADD_CURRICULUM_SUBJECT:`Added subject #${h.entity_id} to the ${d.track||''} track`,REMOVE_CURRICULUM_SUBJECT:`Removed subject #${h.entity_id} from the ${d.track||''} track`};
  return labels[h.action]||h.action;
}
function bindCurriculum(){
  $('#addSubjectBtn').onclick=async()=>{
    const subject_name=$('#newSubjectName').value.trim();
    const dept_id=$('#newSubjectDept').value?Number($('#newSubjectDept').value):null;
    const ca_max=Number($('#newSubjectCa').value), exam_max=Number($('#newSubjectExam').value);
    if(!subject_name) return toast('Enter a subject name.','error');
    if(!Number.isFinite(ca_max)||!Number.isFinite(exam_max)) return toast('CA and exam maximums must be numbers.','error');
    try{ await createSubject({subject_name,dept_id,ca_max,exam_max}); toast('Subject added.','success'); render('curriculum'); }
    catch(e){ toast(e.message,'error'); }
  };
  document.querySelectorAll('[data-track-toggle]').forEach(b=>b.onclick=async()=>{
    const subject_id=Number(b.dataset.trackToggle), track=b.dataset.track, enabled=b.dataset.on!=='1';
    if(!enabled && !confirm(`Remove this subject from the ${track} track? Teachers on that track will no longer be able to enter new scores for it.`)) return;
    b.disabled=true;
    try{ await toggleCurriculum(track,subject_id,enabled); toast(enabled?`Added to the ${track} track.`:`Removed from the ${track} track.`,'success'); render('curriculum'); }
    catch(e){ toast(e.message,'error'); b.disabled=false; }
  });
  document.querySelectorAll('[data-subject-toggle]').forEach(b=>b.onclick=async()=>{
    const id=Number(b.dataset.subjectToggle), makeActive=b.dataset.active!=='1';
    if(!makeActive && !confirm('Mark this subject as no longer offered? Existing results stay untouched, but teachers will no longer be able to enter new scores for it.')) return;
    try{ await updateSubjectStatus(id,makeActive); toast(makeActive?'Subject re-offered.':'Subject marked as no longer offered.','success'); render('curriculum'); }
    catch(e){ toast(e.message,'error'); }
  });
}

function studentStatusModal(id,currentStatus,name){
  const options=STUDENT_STATUSES.map(s=>`<option value="${s}" ${s===currentStatus?'selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`).join('');
  openModal(`Change status — ${name}`,`<div class="portal-form-grid"><div class="form-group full"><label>New status</label><select id="newStudentStatus">${options}</select></div><div class="form-group full"><label>Reason (optional)</label><input id="statusReason" maxlength="160" placeholder="e.g. Transferred, yet to resume for the new term…"></div><div class="full"><button class="btn btn-primary" id="confirmStatus">Save status</button></div></div>`);
  $('#confirmStatus').onclick=async()=>{
    const status=$('#newStudentStatus').value, reason=$('#statusReason').value.trim()||null;
    if(status!==currentStatus && !confirm(`Change ${name}'s status from ${currentStatus} to ${status}?`)) return;
    try{ await updateStudentStatus(id,status,reason); closeModal(); toast('Student status updated.','success'); render('students'); }
    catch(e){ toast(e.message,'error'); }
  };
}

function renderAiImport(){ const terms=(state.meta?.terms||[]).filter(t=>!t.result_locked); return `<div class="portal-toolbar"><div><div class="eyebrow">Assisted data entry</div><h1>Score-Sheet Scanner (OCR)</h1><p>Capture or upload a score sheet, review the extracted values, then submit verified scores for HOD approval.</p></div><span id="aiStatusBadge" class="portal-badge pending">Checking OCR engine…</span></div>${card('1. Select assignment',`<div class="portal-form-grid"><div class="form-group"><label for="aiAssignment">Teaching assignment</label><select id="aiAssignment"><option value="">Select class, arm and subject</option>${state.assignments.map(a=>`<option value="${a.id}">${esc(a.class_name)} ${esc(a.arm_name)} · ${esc(a.subject_name)} · ${esc(a.session_name)}</option>`).join('')}</select></div><div class="form-group"><label for="aiTerm">Academic term</label><select id="aiTerm"><option value="">Select term</option>${terms.map(t=>`<option value="${t.id}" ${t.is_current?'selected':''}>${esc(t.session_name)} · ${esc(t.term_name)}</option>`).join('')}</select></div></div>`)}${card('2. Capture or upload',`<div class="ai-dropzone"><div class="ai-drop-icon">${ic('plus',20)}</div><h3>Score sheet image</h3><p>Use a clear, well-lit JPG, PNG or WebP image. The image is processed for extraction and is not stored by this feature.</p><div class="portal-actions"><label class="btn btn-primary" for="aiImage">Choose image<input id="aiImage" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden></label><button class="btn btn-secondary" id="aiAnalyze" disabled>Analyze sheet</button></div><small id="aiFileName">No image selected</small></div>`)}<div id="aiResults"></div>`; }
function bindAiImport(){
  const badge=$('#aiStatusBadge'), file=$('#aiImage'), analyze=$('#aiAnalyze'), assignment=$('#aiAssignment'), term=$('#aiTerm'), fileName=$('#aiFileName'), results=$('#aiResults');
  getAiStatus().then(s=>{ badge.textContent=s.available?'Scanner ready':'OCR unavailable — manual entry available'; badge.className=`portal-badge ${s.available?'ok':'pending'}`; analyze.dataset.available=s.available?'1':'0'; }).catch(()=>{badge.textContent='OCR unavailable — manual entry available';});
  let selectedFile=null;
  file.onchange=()=>{selectedFile=file.files?.[0]||null; fileName.textContent=selectedFile?`${selectedFile.name} · ${(selectedFile.size/1024/1024).toFixed(1)} MB`:'No image selected'; analyze.disabled=!selectedFile||!assignment.value||!term.value;};
  assignment.onchange=()=>{analyze.disabled=!selectedFile||!assignment.value||!term.value;};
  analyze.onclick=async()=>{if(!selectedFile||!assignment.value||!term.value)return; analyze.disabled=true; analyze.textContent='Analyzing…'; results.innerHTML=`<div class="portal-card"><div class="portal-loading"><span class="loading"></span><p>Reading the score sheet and matching rows against the class roster…</p></div></div>`; try{const dataUrl=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(selectedFile);}); const out=await aiImportScores({assignment_id:Number(assignment.value),term_id:Number(term.value),image:dataUrl}); renderAiReview(out,results); }catch(e){results.innerHTML=`<div class="portal-card"><div class="portal-empty"><h3>Scan could not be completed</h3><p>${esc(e.message)}</p><button class="btn btn-secondary" id="aiManualFallback" data-go="scores">Continue with manual score entry</button></div></div>`; document.querySelector('#aiManualFallback')?.addEventListener('click',()=>render('scores'));}finally{analyze.disabled=false;analyze.textContent='Analyze sheet';}};
}
// Working copy of the scanner's extracted rows, editable in the browser
// before anything is submitted: teachers previously had no way to fix a
// wrong/duplicate student match or add one the scan missed entirely — they
// could only tweak the two score numbers. This keeps a live array and
// re-renders just this section (never a full page reload) on every edit.
let aiRows = [], aiCM = 30, aiEM = 70, aiAssignment = null, aiTermId = null;

function renderAiReview(data, target){
  aiRows = (data.rows || []).map(r => ({ ...r }));
  aiCM = Number(data.assignment?.ca_max) || 30;
  aiEM = Number(data.assignment?.exam_max) || 70;
  aiAssignment = data.assignment;
  aiTermId = data.term_id;
  renderAiTable(target);
}

function syncAiInputs(target){
  target.querySelectorAll('.ai-score-input').forEach(inp=>{
    const i=Number(inp.dataset.aiRow), field=inp.dataset.field==='ca'?'ca_score':'exam_score';
    aiRows[i][field] = inp.value===''?'':Number(inp.value);
  });
  target.querySelectorAll('.ai-student-select').forEach(sel=>{
    const i=Number(sel.dataset.aiRow);
    aiRows[i].user_code = sel.value || null;
    aiRows[i].full_name = sel.value ? (state.students.find(s=>s.user_code===sel.value)?.full_name || null) : null;
  });
}

function renderAiTable(target){
  const counts = {};
  aiRows.forEach(r=>{ if(r.user_code) counts[r.user_code]=(counts[r.user_code]||0)+1; });
  const dupCount = Object.values(counts).filter(c=>c>1).length;
  const studentOptions = code => `<option value="">— Select student —</option>${state.students.map(s=>`<option value="${esc(s.user_code)}" ${s.user_code===code?'selected':''}>${esc(s.full_name)} (${esc(s.user_code)})</option>`).join('')}`;
  const body = aiRows.map((r,i)=>{
    const isDup = r.user_code && counts[r.user_code] > 1;
    return `<tr class="${isDup?'ai-row-duplicate':''}">
      <td><select class="ai-student-select" data-ai-row="${i}">${studentOptions(r.user_code)}</select>
        ${isDup?'<small class="ai-note ai-note-danger">Duplicate — remove one</small>':!r.user_code?'<small class="ai-note">Unmatched — pick the student</small>':''}</td>
      <td><input class="ai-score-input" data-ai-row="${i}" data-field="ca" type="number" min="0" max="${aiCM}" value="${r.ca_score??''}"></td>
      <td><input class="ai-score-input" data-ai-row="${i}" data-field="exam" type="number" min="0" max="${aiEM}" value="${r.exam_score??''}"></td>
      <td><span class="portal-badge ${r.confidence>=.9&&r.valid_ca&&r.valid_exam?'ok':'pending'}">${r.confidence!=null?Math.round(r.confidence*100)+'%':'Manual'}</span>${r.note?`<small class="ai-note">${esc(r.note)}</small>`:''}</td>
      <td><button class="btn btn-secondary ai-remove-btn" data-ai-remove="${i}" title="Remove this row">${ic('x',14)}</button></td>
    </tr>`;
  }).join('');
  target.innerHTML = `${card('3. Verify extracted scores',
    `<div class="ai-review-note"><strong>Nothing is published automatically.</strong> Review every row — reassign a wrong or unmatched student, remove duplicates, or add a row for a student the scan missed — before submitting.</div>
    ${dupCount?`<div class="ai-review-note ai-review-warn">${dupCount} student${dupCount===1?' appears':'s appear'} more than once below. Remove the extra row(s) before submitting.</div>`:''}
    ${table(['Student',`CA / ${aiCM}`,`Exam / ${aiEM}`,'Confidence',''], body, 'No rows yet — use "Add student row" below.')}
    <div class="portal-actions"><button class="btn btn-secondary" id="addAiRow">${ic('plus',15)} Add student row</button></div>
    <div class="portal-actions"><button class="btn btn-primary" id="submitAiScores">Submit verified scores</button><button class="btn btn-secondary" id="discardAiScores">Discard and retry</button></div>`
  )}`;

  target.querySelectorAll('.ai-student-select').forEach(sel=>sel.onchange=()=>{ syncAiInputs(target); renderAiTable(target); });
  target.querySelectorAll('[data-ai-remove]').forEach(b=>b.onclick=()=>{ syncAiInputs(target); aiRows.splice(Number(b.dataset.aiRemove),1); renderAiTable(target); });
  $('#addAiRow').onclick=()=>{ syncAiInputs(target); aiRows.push({ user_code:null, full_name:null, ca_score:'', exam_score:'', confidence:null, valid_ca:true, valid_exam:true, note:null }); renderAiTable(target); };

  const submit = $('#submitAiScores');
  submit.onclick = async () => {
    syncAiInputs(target);
    const unassigned = aiRows.filter(r=>!r.user_code);
    if(unassigned.length) return toast(`${unassigned.length} row(s) still need a student selected.`,'error');
    const hasDupes = aiRows.some((r,i)=>aiRows.findIndex(x=>x.user_code===r.user_code)!==i);
    if(hasDupes) return toast('Remove duplicate student rows before submitting.','error');
    const invalid = aiRows.filter(r=>!Number.isFinite(r.ca_score)||r.ca_score<0||r.ca_score>aiCM||!Number.isFinite(r.exam_score)||r.exam_score<0||r.exam_score>aiEM);
    if(invalid.length) return toast(`${invalid.length} row(s) need valid scores before submission.`,'error');
    submit.disabled=true; submit.textContent='Submitting…';
    try{
      for(const r of aiRows) await uploadResult({ student_code:r.user_code, subject_name:aiAssignment.subject_name, term_id:Number(aiTermId), ca_score:r.ca_score, exam_score:r.exam_score });
      toast(`${aiRows.length} verified score(s) sent for HOD approval.`,'success');
      render('scores');
    }catch(e){ toast(e.message,'error'); submit.disabled=false; submit.textContent='Submit verified scores'; }
  };
  $('#discardAiScores').onclick=()=>render('ai-import');
}

function bindPanel(panel){
  document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>render(b.dataset.go));
  if(panel==='scores') bindScores();
  if(panel==='ai-import') bindAiImport();
  if(panel==='approval') document.querySelectorAll('[data-approve]').forEach(b=>b.onclick=()=>approveOne(b.dataset.approve));
  if(panel==='approval') document.querySelectorAll('[data-reject]').forEach(b=>b.onclick=()=>rejectOne(b.dataset.reject));
  if(panel==='announcements') bindAnnouncements();
  if(panel==='curriculum' && ['admin','commandant'].includes(state.user.role)) bindCurriculum();
  if(panel==='sessions' && ['admin','commandant'].includes(state.user.role)) bindSessions();
  if(panel==='classes' && ['admin','commandant'].includes(state.user.role)) bindClassesArms();
  if(panel==='departments') bindDepartments();
  if(panel==='students'){
    bindSearch('students', async q => { state.search.students=q; render('students',{silent:true}); });
    if(['admin','commandant'].includes(state.user.role)){
      $('#studentStatusFilter')?.addEventListener('change',async e=>{ state.studentStatusFilter=e.target.value; render('students'); });
      document.querySelectorAll('[data-status-student]').forEach(b=>b.onclick=()=>studentStatusModal(Number(b.dataset.statusStudent),b.dataset.statusCurrent,b.dataset.statusName));
    }
  }
  if(panel==='teachers') bindSearch('teachers', q => { state.search.teachers=q; render('teachers',{silent:true}); });
  if(panel==='results' && ['admin','commandant'].includes(state.user.role)) bindSearch('results', q => { state.search.results=q; render('results',{silent:true}); });
  if(panel==='accounts' && ['admin','commandant'].includes(state.user.role)) {
    $('#newUser')?.addEventListener('click',userModal);
    bindSearch('accounts', q => { state.search.accounts=q; render('accounts',{silent:true}); });
    document.querySelectorAll('[data-remove-user]').forEach(b=>b.onclick=()=>removeAccount(b.dataset.removeUser));
    document.querySelectorAll('[data-reset-password]').forEach(b=>b.onclick=()=>resetPasswordModal(Number(b.dataset.resetPassword),b.dataset.resetName));
  }
  if(panel==='profile') bindProfile();
}
function renderSessions(){
  const rows = state.sessions.map(s=>{
    const termsHtml = s.terms.map(t=>`<div class="portal-kpi"><span>${esc(t.term_name)} ${t.is_current?'<span class="portal-badge ok">Current</span>':''} ${t.result_locked?'<span class="portal-badge danger">Locked</span>':''}</span><span class="portal-actions"><button class="btn btn-sm btn-secondary" data-term-current="${t.id}" ${t.is_current?'disabled':''}>Set current</button><button class="btn btn-sm ${t.result_locked?'btn-secondary':'btn-danger'}" data-term-lock="${t.id}" data-locked="${t.result_locked?'1':'0'}">${t.result_locked?'Unlock':'Lock'} results</button></span></div>`).join('') || '<p style="color:var(--text-secondary);font-size:.85rem">No terms added yet.</p>';
    const missingTerms = [1,2,3].filter(n=>!s.terms.some(t=>t.term_number===n));
    const addTermForm = missingTerms.length ? `<div class="portal-actions" style="margin-top:.6rem"><select id="newTermNumber-${s.id}">${missingTerms.map(n=>`<option value="${n}">${['','First','Second','Third'][n]} Term</option>`).join('')}</select><button class="btn btn-sm btn-secondary" data-add-term="${s.id}">Add term</button></div>` : '';
    return `<div class="portal-card" style="margin-bottom:1rem"><div class="portal-card-head"><h3>${esc(s.session_name)} ${s.is_current?'<span class="portal-badge ok">Current session</span>':''}</h3>${!s.is_current?`<button class="btn btn-sm btn-primary" data-session-current="${s.id}">Make current</button>`:''}</div><div class="portal-card-body">${termsHtml}${addTermForm}</div></div>`;
  }).join('') || '<div class="portal-empty">No academic sessions yet.</div>';
  const addSessionForm = `<div class="portal-form-grid"><div class="form-group"><label>Session name</label><input id="newSessionName" placeholder="e.g. 2027/2028"></div><div class="form-group"><label>Start date</label><input id="newSessionStart" type="date"></div><div class="form-group"><label>End date</label><input id="newSessionEnd" type="date"></div><div class="form-group" style="align-self:end"><label style="display:flex;align-items:center;gap:.4rem;cursor:pointer;font-weight:500"><input type="checkbox" id="newSessionCurrent" style="width:auto"> Make this the current session</label></div><div class="full"><button class="btn btn-primary" id="addSessionBtn">Create session</button></div></div>`;
  return `<div class="portal-toolbar"><div><div class="eyebrow">Academic calendar</div><h1>Academic Sessions</h1><p>Roll into a new session each year and control which term is open for scoring.</p></div></div>${card('Start a new session',addSessionForm)}${rows}`;
}
function bindSessions(){
  $('#addSessionBtn').onclick=async()=>{
    const session_name=$('#newSessionName').value.trim();
    const start_date=$('#newSessionStart').value||null;
    const end_date=$('#newSessionEnd').value||null;
    const make_current=$('#newSessionCurrent').checked;
    if(!/^\d{4}\/\d{4}$/.test(session_name)) return toast('Session name must look like 2027/2028.','error');
    try{ await createSession({session_name,start_date,end_date,make_current}); toast('Academic session created.','success'); render('sessions'); }
    catch(e){ toast(e.message,'error'); }
  };
  document.querySelectorAll('[data-session-current]').forEach(b=>b.onclick=async()=>{
    if(!confirm('Make this the current academic session? Teacher/student defaults will switch to it.')) return;
    try{ await activateSession(Number(b.dataset.sessionCurrent)); toast('Current session updated.','success'); render('sessions'); }
    catch(e){ toast(e.message,'error'); }
  });
  document.querySelectorAll('[data-add-term]').forEach(b=>b.onclick=async()=>{
    const sessionId=Number(b.dataset.addTerm);
    const term_number=Number($(`#newTermNumber-${sessionId}`).value);
    try{ await createTerm(sessionId,{term_number}); toast('Term added.','success'); render('sessions'); }
    catch(e){ toast(e.message,'error'); }
  });
  document.querySelectorAll('[data-term-current]').forEach(b=>b.onclick=async()=>{
    try{ await updateTerm(Number(b.dataset.termCurrent),{is_current:true}); toast('Current term updated.','success'); render('sessions'); }
    catch(e){ toast(e.message,'error'); }
  });
  document.querySelectorAll('[data-term-lock]').forEach(b=>b.onclick=async()=>{
    const locked=b.dataset.locked==='1';
    if(!locked && !confirm('Lock this term? Teachers will no longer be able to submit or edit scores for it.')) return;
    try{ await updateTerm(Number(b.dataset.termLock),{result_locked:!locked}); toast(locked?'Term unlocked.':'Term locked.','success'); render('sessions'); }
    catch(e){ toast(e.message,'error'); }
  });
}
function bindProfile(){
  $('#changePasswordBtn').onclick=async()=>{
    const current=$('#pwdCurrent').value, next=$('#pwdNew').value, confirm=$('#pwdConfirm').value;
    if(!current||!next) return toast('Fill in both your current and new password.','error');
    if(next.length<8) return toast('New password must be at least 8 characters.','error');
    if(next!==confirm) return toast('New password and confirmation do not match.','error');
    if(next===current) return toast('New password must be different from your current password.','error');
    const btn=$('#changePasswordBtn'); btn.disabled=true;
    try{ await changeMyPassword(current,next); toast('Password updated successfully.','success'); $('#pwdCurrent').value=$('#pwdNew').value=$('#pwdConfirm').value=''; }
    catch(e){ toast(e.message,'error'); } finally { btn.disabled=false; }
  };
}
function resetPasswordModal(userId,name){
  openModal(`Reset password — ${name}`,`<div class="portal-form-grid">${pwdField("resetPwdNew","New password (min. 8 characters)","new-password",'minlength="8"')}${pwdField("resetPwdConfirm","Confirm new password","new-password",'minlength="8"')}<p style="color:var(--text-secondary);font-size:.85rem">Share the new password with ${esc(name)} directly. They can change it themselves afterward from My Profile.</p><div class="full"><button class="btn btn-primary" id="confirmResetPwd">Set new password</button></div></div>`);
  $('#confirmResetPwd').onclick=async()=>{
    const next=$('#resetPwdNew').value, confirm=$('#resetPwdConfirm').value;
    if(next.length<8) return toast('New password must be at least 8 characters.','error');
    if(next!==confirm) return toast('New password and confirmation do not match.','error');
    try{ await resetUserPassword(userId,next); closeModal(); toast('Password reset successfully.','success'); }
    catch(e){ toast(e.message,'error'); }
  };
}
function bindScores(){
  const assignment=$('#scoreAssignment'), student=$('#scoreStudent'), term=$('#scoreTerm');
  const terms=(state.meta?.terms||[]).filter(t=>!t.result_locked);
  term.innerHTML=terms.map(t=>`<option value="${t.id}" ${t.is_current?'selected':''}>${esc(t.session_name)} — ${esc(t.term_name)}</option>`).join('') || '<option value="">No unlocked terms</option>';
  assignment.onchange=()=>{ const opt=assignment.selectedOptions[0]; if(!opt?.dataset.class){student.innerHTML='<option>Select assignment first…</option>';$('#caRange').textContent='(select assignment)';$('#examRange').textContent='(select assignment)';return;}
    // Bounds come from the selected subject, which may weight CA/exam differently.
    const cm=Number(opt.dataset.camax)||30, em=Number(opt.dataset.exammax)||70;
    $('#caScore').max=cm; $('#examScore').max=em; $('#caRange').textContent=`(0–${cm})`; $('#examRange').textContent=`(0–${em})`; const matches=state.students.filter(s=>s.class===opt.dataset.class && s.arm===opt.dataset.arm); student.innerHTML=matches.map(s=>`<option value="${esc(s.user_code)}">${esc(s.full_name)} — ${esc(s.user_code)}</option>`).join('') || '<option value="">No assigned students</option>'; };
  $('#clearScore').onclick=()=>{ $('#caScore').value=''; $('#examScore').value=''; };
  $('#saveScore').onclick=async()=>{ const opt=assignment.selectedOptions[0]; if(!opt?.value||!student.value||!term.value) return toast('Select assignment, student and term.','error'); const cm=Number(opt.dataset.camax)||30, em=Number(opt.dataset.exammax)||70; const ca=Number($('#caScore').value),exam=Number($('#examScore').value); if(!Number.isFinite(ca)||!Number.isFinite(exam)||ca<0||ca>cm||exam<0||exam>em) return toast(`CA must be 0–${cm} and exam must be 0–${em}.`,'error'); try{ $('#saveScore').disabled=true; await uploadResult({student_code:student.value,subject_name:opt.dataset.subject,term_id:Number(term.value),ca_score:ca,exam_score:exam}); toast('Score saved and sent for HOD approval.','success'); $('#clearScore').click(); }catch(e){toast(e.message,'error')}finally{$('#saveScore').disabled=false;} };
}
async function approveOne(id){ if(!confirm('Approve this result? It will become visible to the student.')) return; try{await approveResult(id);toast('Result approved.','success');render('approval')}catch(e){toast(e.message,'error')} }
// A reason is mandatory here (the teacher needs to know what to fix), and
// requiring it doubles as the confirmation step the HOD has to deliberately
// go through — same principle as "Approve"'s confirm(), just with a reason
// attached instead of a bare yes/no.
function rejectOne(id){
  openModal('Disapprove result',`<div class="portal-form-grid"><div class="form-group full"><label>Reason for the teacher *</label><textarea id="rejectNote" rows="4" placeholder="e.g. Exam score looks like a typo — please re-check and resubmit."></textarea></div><div class="full"><button class="btn btn-danger" id="confirmReject">Disapprove result</button></div></div>`);
  $('#confirmReject').onclick=async()=>{
    const note=$('#rejectNote').value.trim();
    if(!note) return toast('A reason is required so the teacher knows what to correct.','error');
    if(!confirm('Send this result back to the teacher for correction? The student will not see it until it is resubmitted and re-approved.')) return;
    try{ await rejectResult(id,note); closeModal(); toast('Result sent back for correction.','success'); render('approval'); }
    catch(e){ toast(e.message,'error'); }
  };
}

async function removeAccount(id){ if(!confirm('Remove portal access for this account? Academic history will be preserved.')) return; try{ await removeUser(id); toast('Portal access removed.','success'); state.accounts=[]; render('accounts'); }catch(e){ toast(e.message,'error'); } }

async function loadMeta(){ if(!state.meta) state.meta=await getAdminMeta(); return state.meta; }
async function userModal(){ const m=await loadMeta(); const classOpts=m.classes.map(x=>`<option value="${esc(x.level_name)}">${esc(x.level_name)}</option>`).join(''); const armOpts=m.arms.map(x=>`<option value="${esc(x.arm_name)}">${esc(x.arm_name)}</option>`).join(''); const deptOpts=m.departments.map(x=>`<option value="${x.id}">${esc(x.dept_name)}</option>`).join(''); const subOpts=m.subjects.map(x=>`<option value="${esc(x.subject_name)}">${esc(x.subject_name)}</option>`).join(''); openModal('Create portal account',`<div class="portal-form-grid"><div class="form-group"><label>User ID *</label><input id="uCode" maxlength="20" placeholder="e.g. STU004"></div>${pwdField("uPass","Initial password *","new-password",'minlength="8"')}<div class="form-group full"><label>Full name *</label><input id="uName"></div><div class="form-group"><label>Email</label><input id="uEmail" type="email"></div><div class="form-group"><label>Gender</label><select id="uGender"><option value="">Not specified</option><option value="M">Male</option><option value="F">Female</option></select></div><div class="form-group"><label>Role *</label><select id="uRole"><option value="student">Student</option><option value="teacher">Teacher</option><option value="hod">HOD</option>${state.user.role==='commandant'?'<option value="admin">Administrator</option><option value="commandant">Commandant</option>':''}</select></div><div id="studentFields" class="full"><div class="portal-form-grid"><div class="form-group"><label>Class</label><select id="uClass">${classOpts}</select></div><div class="form-group"><label>Arm</label><select id="uArm">${armOpts}</select></div><div class="form-group"><label>Track</label><select id="uTrack"><option>junior</option><option>science</option><option>technical</option><option>arts</option></select></div><div class="form-group"><label>Admission no.</label><input id="uAdmission"></div></div></div><div id="staffFields" class="full" style="display:none"><div class="portal-form-grid"><div class="form-group"><label>Department</label><select id="uDept">${deptOpts}</select></div><div class="form-group"><label>Subject (teacher)</label><select id="uSubject">${subOpts}</select></div></div></div><div class="full"><button class="btn btn-primary" id="createAccount">Create account</button></div></div>`); const role=$('#uRole'); const sync=()=>{ $('#studentFields').style.display=role.value==='student'?'block':'none'; $('#staffFields').style.display=['teacher','hod'].includes(role.value)?'block':'none'; $('#uSubject').closest('.form-group').style.display=role.value==='teacher'?'block':'none';}; role.onchange=sync;sync(); $('#createAccount').onclick=async()=>{const payload={user_code:$('#uCode').value.trim().toUpperCase(),password:$('#uPass').value,full_name:$('#uName').value.trim(),email:$('#uEmail').value.trim()||null,gender:$('#uGender').value||null,role:role.value};if(role.value==='student')Object.assign(payload,{class_level:$('#uClass').value,arm:$('#uArm').value,track:$('#uTrack').value,admission_no:$('#uAdmission').value.trim()||null});if(['teacher','hod'].includes(role.value))payload.department_id=Number($('#uDept').value);if(role.value==='teacher')payload.subjects=$('#uSubject').value ? [$('#uSubject').value] : [];if(!payload.user_code||!payload.password||!payload.full_name)return toast('Complete the required fields.','error');try{await createUser(payload);closeModal();toast('Account created successfully.','success');state.accounts=[];render('accounts')}catch(e){toast(e.message,'error')}}; }

// Admin can use the same student screen to create accounts. Keep the feature visible but controlled.
window.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
init();
