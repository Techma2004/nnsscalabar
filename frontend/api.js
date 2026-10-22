// NNSS Calabar API client. The backend serves this frontend in production,
// so relative URLs work locally and on cloud hosts without hard-coded localhost URLs.
const API_BASE = '/api';
let currentUser = null;

async function apiFetch(endpoint, options = {}) {
  const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers, credentials: 'include' });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : { error: await response.text() };
  if (response.status === 401) {
    currentUser = null;
    sessionStorage.removeItem('nnss_user');
    // The sign-in ran out while the portal was open. Loading a screen sends the person
    // to the login page and brings them back to the same screen afterwards. A save or
    // other change is never interrupted: it shows the error instead, so nothing typed is lost.
    const reading = !options.method || options.method === 'GET';
    if (reading && endpoint !== '/auth/me' && /portal\.html$/.test(location.pathname)) {
      const here = location.hash.replace(/^#/, '');
      location.href = `login.html?expired=1${here ? `&next=${encodeURIComponent(here)}` : ''}`;
    }
  }
  if (!response.ok) {
    const err = new Error(data.error || `Request failed (${response.status}).`);
    err.status = response.status;
    err.data = data; // e.g. data.row_errors from a rejected score sheet
    throw err;
  }
  return data;
}

export async function login(user_code, password) {
  const data = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ user_code, password }) });
  currentUser = data.user;
  sessionStorage.setItem('nnss_user', JSON.stringify(currentUser));
  return currentUser;
}
export async function logout() { try { await apiFetch('/auth/logout', { method: 'POST' }); } finally { currentUser = null; sessionStorage.removeItem('nnss_user'); } }
export async function getCurrentUser() { currentUser = await apiFetch('/auth/me'); sessionStorage.setItem('nnss_user', JSON.stringify(currentUser)); return currentUser; }

function qs(params) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries)}` : '';
}

export const createUser = data => apiFetch('/admin/users', { method: 'POST', body: JSON.stringify(data) });
export const getAdminMeta = () => apiFetch('/admin/meta');
export const getAllUsers = q => apiFetch(`/admin/users${qs({ q })}`);
export const getAllTeachers = q => apiFetch(`/admin/teachers${qs({ q })}`);
export const getAllResults = q => apiFetch(`/admin/results${qs({ q })}`);
export const updateUserStatus = (id, is_active) => apiFetch(`/admin/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ is_active }) });
export const removeUser = id => apiFetch(`/admin/users/${id}`, { method: 'DELETE' });
export const changeMyPassword = (current_password, new_password) => apiFetch('/auth/password', { method: 'PATCH', body: JSON.stringify({ current_password, new_password }) });
export const resetUserPassword = (id, new_password) => apiFetch(`/admin/users/${id}/password`, { method: 'PATCH', body: JSON.stringify({ new_password }) });

export const getAllStudents = (status, q) => apiFetch(`/students${qs({ status, q })}`);
export const getStudent = code => apiFetch(`/students/${encodeURIComponent(code)}`);
export const getStudentSubjects = code => apiFetch(`/students/${encodeURIComponent(code)}/subjects`);
export const getTeacherStudents = (code, q) => apiFetch(`/students/teacher/${encodeURIComponent(code)}${qs({ q })}`);
export const updateStudentStatus = (id, status, reason) => apiFetch(`/admin/students/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason }) });

export const getSubjects = () => apiFetch('/admin/subjects');
export const createSubject = data => apiFetch('/admin/subjects', { method: 'POST', body: JSON.stringify(data) });
export const updateSubject = (id, data) => apiFetch(`/admin/subjects/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const updateSubjectStatus = (id, is_active) => apiFetch(`/admin/subjects/${id}/status`, { method: 'PATCH', body: JSON.stringify({ is_active }) });
export const toggleCurriculum = (track, subject_id, enabled) => apiFetch('/admin/curriculum/toggle', { method: 'POST', body: JSON.stringify({ track, subject_id, enabled }) });
export const getCurriculumHistory = () => apiFetch('/admin/curriculum/history');
export const createDepartment = data => apiFetch('/admin/departments', { method: 'POST', body: JSON.stringify(data) });
export const deleteDepartment = id => apiFetch(`/admin/departments/${id}`, { method: 'DELETE' });
export const migrateTeacherDepartment = (teacherId, dept_id) => apiFetch(`/admin/teachers/${teacherId}/department`, { method: 'PATCH', body: JSON.stringify({ dept_id }) });
export const promoteStudents = (sessionId, dry_run, force) => apiFetch(`/admin/sessions/${sessionId}/promote`, { method: 'POST', body: JSON.stringify({ dry_run, force }) });

export const getDepartments = () => apiFetch('/admin/departments');
export const getDepartmentDetail = id => apiFetch(`/admin/departments/${id}`);
export const getClassesAndArms = () => apiFetch('/admin/classes');
export const createClassLevel = data => apiFetch('/admin/classes', { method: 'POST', body: JSON.stringify(data) });
export const updateClassLevel = (id, data) => apiFetch(`/admin/classes/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteClassLevel = id => apiFetch(`/admin/classes/${id}`, { method: 'DELETE' });
export const createArm = data => apiFetch('/admin/arms', { method: 'POST', body: JSON.stringify(data) });
export const updateArm = (id, data) => apiFetch(`/admin/arms/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteArm = id => apiFetch(`/admin/arms/${id}`, { method: 'DELETE' });
export const getHodSummary = () => apiFetch('/dashboard/hod-summary');

export const getSessions = () => apiFetch('/admin/sessions');
export const createSession = data => apiFetch('/admin/sessions', { method: 'POST', body: JSON.stringify(data) });
export const activateSession = id => apiFetch(`/admin/sessions/${id}/activate`, { method: 'PATCH' });
export const createTerm = (sessionId, data) => apiFetch(`/admin/sessions/${sessionId}/terms`, { method: 'POST', body: JSON.stringify(data) });
export const updateTerm = (id, data) => apiFetch(`/admin/terms/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const getAssignments = () => apiFetch('/results/assignments');
// The Teaching Assignments workspace (frontend/assignments.js) imports these
// three by name — without them the whole module fails to load in the
// browser (a missing named ES-module export is a hard error, not a warning),
// which is why the "Teaching Assignments" nav link has never actually
// appeared for anyone despite the backend route and the UI module both
// being fully built.
export const getAssignmentMeta = () => apiFetch('/assignments/meta');
export const getTeacherAssignments = teacherId => apiFetch(`/assignments/teacher/${teacherId}`);
export const updateTeacherAssignments = (teacherId, data) => apiFetch(`/assignments/teacher/${teacherId}`, { method: 'PUT', body: JSON.stringify(data) });
// Continuous Assessment Sheet (one subject x one class+arm x one term).
export const getScheme = () => apiFetch('/results/scheme');
export const getSheetIndex = term_id => apiFetch(`/results/sheets${qs({ term_id })}`);
export const getSheet = params => apiFetch(`/results/sheet${qs(params)}`);
export const saveSheet = data => apiFetch('/results/sheet', { method: 'POST', body: JSON.stringify(data) });
export const importSheetFile = data => apiFetch('/results/sheet/import', { method: 'POST', body: JSON.stringify(data) });
export const approveSheet = data => apiFetch('/results/approve-sheet', { method: 'PUT', body: JSON.stringify(data) });
export const sheetDownloadUrl = (kind, params = {}) => `${API_BASE}/results/sheet/${kind}${qs(params)}`;
export const getPendingResults = () => apiFetch('/results/pending');
export const approveResult = (id, note) => apiFetch(`/results/approve/${id}`, { method: 'PUT', body: JSON.stringify({ note }) });
export const rejectResult = (id, note) => apiFetch(`/results/reject/${id}`, { method: 'PUT', body: JSON.stringify({ note }) });
export const getRejections = () => apiFetch('/results/rejections');
export const getStudentResults = code => apiFetch(`/results/student/${encodeURIComponent(code)}`);
export const getStudentTermStats = code => apiFetch(`/results/student/${encodeURIComponent(code)}/term-stats`);

export const getAnnouncements = () => apiFetch('/announcements');
export const createAnnouncement = data => apiFetch('/announcements', { method: 'POST', body: JSON.stringify(data) });
export const getManagedAnnouncements = q => apiFetch(`/announcements/manage${qs({ q })}`);
export const updateAnnouncement = (id, data) => apiFetch(`/announcements/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteAnnouncement = id => apiFetch(`/announcements/${id}`, { method: 'DELETE' });
export const getStats = () => apiFetch('/dashboard/stats');
export const getStudentSummary = () => apiFetch('/dashboard/student-summary');
export const getTopPerformers = params => apiFetch(`/dashboard/top-performers${qs(params || {})}`);
export const getCommandantSummary = term_id => apiFetch(`/dashboard/commandant-summary${qs({ term_id })}`);

export const getAiStatus = () => apiFetch('/results/ai-status');
export const aiImportScores = data => apiFetch('/results/ai-import', { method: 'POST', body: JSON.stringify(data) });

// ---- People directory and profiles (HOD: own department; Admin / Commandant: everyone)
export const getDirectory = (kind, q, status) => apiFetch(`/people/directory${qs({ kind, q, status })}`);
export const getProfile = userId => apiFetch(`/people/${userId}`);
export const updateContact = (userId, data) => apiFetch(`/admin/users/${userId}/contact`, { method: 'PATCH', body: JSON.stringify(data) });

// ---- Blog and newsletter (school news team)
export const getPublicPosts = kind => apiFetch(`/posts${qs({ kind })}`);
export const getManagedPosts = (kind, q) => apiFetch(`/posts/manage${qs({ kind, q })}`);
export const createPost = data => apiFetch('/posts', { method: 'POST', body: JSON.stringify(data) });
export const updatePost = (id, data) => apiFetch(`/posts/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deletePost = id => apiFetch(`/posts/${id}`, { method: 'DELETE' });
export const uploadPostImage = image => apiFetch('/posts/image', { method: 'POST', body: JSON.stringify({ image }) });

// ---- Student change requests
export const getRequestOptions = () => apiFetch('/requests/options');
export const getMyRequests = () => apiFetch('/requests/mine');
export const createRequest = data => apiFetch('/requests', { method: 'POST', body: JSON.stringify(data) });
export const cancelRequest = id => apiFetch(`/requests/${id}/cancel`, { method: 'PATCH' });
export const getReviewQueue = status => apiFetch(`/requests/review${qs({ status })}`);
export const decideRequest = (id, decision, note) => apiFetch(`/requests/${id}/decision`, { method: 'PATCH', body: JSON.stringify({ decision, note }) });

// ---- Dashboard: what needs attention
export const getAttention = () => apiFetch('/dashboard/attention');
