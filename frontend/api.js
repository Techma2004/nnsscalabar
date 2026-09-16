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
  }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
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
export const createDepartment = data => apiFetch('/admin/departments', { method: 'POST', body: JSON.stringify(data) });

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
export const uploadResult = data => apiFetch('/results/upload', { method: 'POST', body: JSON.stringify(data) });
export const getPendingResults = () => apiFetch('/results/pending');
export const approveResult = (id, note) => apiFetch(`/results/approve/${id}`, { method: 'PUT', body: JSON.stringify({ note }) });
export const getStudentResults = code => apiFetch(`/results/student/${encodeURIComponent(code)}`);

export const getAnnouncements = () => apiFetch('/announcements');
export const createAnnouncement = data => apiFetch('/announcements', { method: 'POST', body: JSON.stringify(data) });
export const getManagedAnnouncements = q => apiFetch(`/announcements/manage${qs({ q })}`);
export const updateAnnouncement = (id, data) => apiFetch(`/announcements/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteAnnouncement = id => apiFetch(`/announcements/${id}`, { method: 'DELETE' });
export const getStats = () => apiFetch('/dashboard/stats');
export const getStudentSummary = () => apiFetch('/dashboard/student-summary');
export const getTopPerformers = () => apiFetch('/dashboard/top-performers');

export const getAiStatus = () => apiFetch('/results/ai-status');
export const aiImportScores = data => apiFetch('/results/ai-import', { method: 'POST', body: JSON.stringify(data) });
