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

export const createUser = data => apiFetch('/admin/users', { method: 'POST', body: JSON.stringify(data) });
export const getAdminMeta = () => apiFetch('/admin/meta');
export const getAllUsers = () => apiFetch('/admin/users');
export const getAllTeachers = () => apiFetch('/admin/teachers');
export const getAllResults = () => apiFetch('/admin/results');
export const updateUserStatus = (id, is_active) => apiFetch(`/admin/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ is_active }) });
export const removeUser = id => apiFetch(`/admin/users/${id}`, { method: 'DELETE' });

export const getAllStudents = (status) => apiFetch(`/students${status ? `?status=${encodeURIComponent(status)}` : ''}`);
export const getStudent = code => apiFetch(`/students/${encodeURIComponent(code)}`);
export const getStudentSubjects = code => apiFetch(`/students/${encodeURIComponent(code)}/subjects`);
export const getTeacherStudents = code => apiFetch(`/students/teacher/${encodeURIComponent(code)}`);
export const updateStudentStatus = (id, status, reason) => apiFetch(`/admin/students/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason }) });

export const getSubjects = () => apiFetch('/admin/subjects');
export const createSubject = data => apiFetch('/admin/subjects', { method: 'POST', body: JSON.stringify(data) });
export const updateSubject = (id, data) => apiFetch(`/admin/subjects/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const updateSubjectStatus = (id, is_active) => apiFetch(`/admin/subjects/${id}/status`, { method: 'PATCH', body: JSON.stringify({ is_active }) });
export const toggleCurriculum = (track, subject_id, enabled) => apiFetch('/admin/curriculum/toggle', { method: 'POST', body: JSON.stringify({ track, subject_id, enabled }) });
export const createDepartment = data => apiFetch('/admin/departments', { method: 'POST', body: JSON.stringify(data) });

export const getAssignments = () => apiFetch('/results/assignments');
export const uploadResult = data => apiFetch('/results/upload', { method: 'POST', body: JSON.stringify(data) });
export const getPendingResults = () => apiFetch('/results/pending');
export const approveResult = (id, note) => apiFetch(`/results/approve/${id}`, { method: 'PUT', body: JSON.stringify({ note }) });
export const getStudentResults = code => apiFetch(`/results/student/${encodeURIComponent(code)}`);

export const getAnnouncements = () => apiFetch('/announcements');
export const createAnnouncement = data => apiFetch('/announcements', { method: 'POST', body: JSON.stringify(data) });
export const getStats = () => apiFetch('/dashboard/stats');
export const getStudentSummary = () => apiFetch('/dashboard/student-summary');
export const getTopPerformers = () => apiFetch('/dashboard/top-performers');

export const getAiStatus = () => apiFetch('/results/ai-status');
export const aiImportScores = data => apiFetch('/results/ai-import', { method: 'POST', body: JSON.stringify(data) });
