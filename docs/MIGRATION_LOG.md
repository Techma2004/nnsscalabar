# NNSS Calabar Engineering Migration Log

## 2026-09-26 — Teaching assignments, results branding, and public homepage fixes

### 1. Teaching assignments

**Problem:** teacher creation was provisioning a subject across every curriculum-compatible class/arm in the current session. That made the stored assignment set much broader than a real teacher's workload.

**Change:** added `backend/routes/assignments.js` and mounted it at `/api/assignments`.

**Behavior:**

- management accounts can configure any teacher;
- HODs are restricted to teachers in their own department;
- a teacher can have one or many subjects;
- each subject can be attached to one or many class/arm combinations;
- assignments are scoped to the current academic session;
- previous-session assignments are preserved;
- curriculum compatibility is validated server-side;
- every update is written to `activity_log`.

The existing `teacher_subjects` and `teacher_class_assignments` tables were reused; no duplicate scheduling schema was introduced.

### 2. Results branding and printing

The shared public/portal stylesheet behavior is now initialized by `frontend/main.js` so every result card receives a centered `command-logo.png` header treatment. The same result card remains the print target, and print CSS removes portal chrome while preserving the branded result layout.

### 3. Mobile hero carousel

The previous carousel used `background-size: cover`, which intentionally crops images when their aspect ratio differs from the viewport. On screens up to 768px, slides now use `contain` with a stable aspect-ratio container so the complete source image remains visible instead of being cropped.

### 4. Hero CTA navigation

Hero CTA buttons now receive explicit navigation handlers based on the intended destination:

- Discover Our School → `about.html`
- Read More → `blog.html`
- Student Portal → `login.html`
- Latest News → `newsletter.html`
- Login Now → `login.html`

The handler uses `document.baseURI` so relative paths remain correct when the frontend is served from a subdirectory or a normal static root.

### 5. Frontend API / portal integration

- `frontend/api.js` now exposes the assignment endpoints.
- `frontend/portal.html` loads the assignment workspace.
- `frontend/assignments.js` adds a role-aware Teaching Assignments workspace without adding a frontend framework or duplicating the portal.

## Verification checklist

Before release, test with the demo/current database:

- [ ] Admin creates a teacher account.
- [ ] Admin opens Teaching Assignments and assigns one subject + one class/arm.
- [ ] Admin adds a second subject and several class/arm combinations.
- [ ] HOD can edit teachers in their department.
- [ ] HOD receives 403 when attempting to edit a teacher outside their department.
- [ ] Teacher score-entry assignment list reflects the saved assignments.
- [ ] A student opens an approved result and sees the centered command logo.
- [ ] Browser print preview matches the displayed result branding.
- [ ] Mobile homepage shows complete carousel images without horizontal cropping.
- [ ] Each hero CTA reaches its intended page.
- [ ] Previous academic-session assignments remain unchanged after current-session edits.

## Engineering principle

Prefer small, isolated changes over rewriting working subsystems. Existing schema and role controls were reused wherever possible; new behavior is implemented behind focused endpoints and a small frontend module.
