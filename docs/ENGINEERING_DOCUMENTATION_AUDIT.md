# NNSS Calabar — Engineering Documentation Audit

> Generated from the current repository state and Git history.

## Current repository

- Branch: `"main"`
- Commit: `"da06e39"`

## Recent implementation history

```text
da06e39 fix frontend navigation responsive layout and portal recovery
b9f8089 docs: record navigation and responsive repairs
a826c94 fix: harden mobile public and portal layouts
3ede638 fix: remove javascript hero navigation override
db6ce7b fix: use semantic navigation links on public home
9be6b41 feat: add searchable teacher assignment picker
f132d60 Merge remote-tracking branch 'origin/main' ok my github repo differed from my local git entirely with dierent codes
a88b4dd fixed backend, frontend and added score sheet template
384da30 fix: keep public page routes independent from portal fallback
294eeea docs: add engineering migration log
fefa60a docs: document teaching assignment workflow
510347e fix: stabilize hero navigation and responsive result presentation
e4c4160 feat: load teaching assignment workspace
be2a2f4 feat: add teaching assignment workspace
b9b8088 feat: expose teaching assignment API
9d645ca feat: mount teaching assignment API
cb9e88a feat: add teaching assignment management
37a7a8c feat(database): add realistic 600-student demo seed
69ad414 Add isolated test database generator with 600 students, 48 teachers, and separate HODs.
37a4a52 style: optimize carousel images for mobile
```

## Frontend

The frontend is served by the Express application and contains the public pages, authentication flow, role-based portal, API client, responsive styles, navigation logic, result presentation, and teaching-assignment workspace.

Key files:

- `frontend/index.html` — public homepage and navigation
- `frontend/login.html` — authentication entry point
- `frontend/portal.html` — authenticated portal shell
- `frontend/portal.js` — role-based portal rendering and workflows
- `frontend/api.js` — centralized API client
- `frontend/main.js` — public-page interactions, navigation, carousel, and shared UI behavior
- `frontend/styles.css` — application and responsive styling

### Responsive hero

Mobile hero presentation uses contained background artwork to reduce unwanted cropping on narrow screens.

### Public navigation

Public-page navigation uses normal page links so About, Blog, Newsletter, and Login/Portal navigation remain independent of portal authentication fallback behavior.

### Portal roles

The portal currently supports Student, Teacher, HOD, Admin, and Commandant workspaces with role-specific navigation and permissions.

### Teaching assignments

Teacher assignments support class/arm and subject relationships through the teaching-assignment API and portal workspace.

### Result presentation

Result views support command branding and responsive presentation.

## Backend

The Express backend serves both the frontend and `/api` endpoints. Authentication uses JWT-protected API routes.

Important route modules:

- `backend/routes/auth.js`
- `backend/routes/admin.js`
- `backend/routes/students.js`
- `backend/routes/results.js`
- `backend/routes/assignments.js`
- `backend/routes/announcements.js`
- `backend/routes/dashboard.js`

## Verification

Frontend JavaScript syntax is checked with:

```bash
node --check frontend/main.js
node --check frontend/portal.js
node --check frontend/api.js
```

Repository changes should also pass:

```bash
git diff --check
```

## Documentation maintenance

Feature work should update the appropriate documentation when it changes architecture, workflows, deployment, migrations, permissions, or other important engineering decisions. Implementation details should remain discoverable from the source code.

## Documentation status

This audit records the major frontend, backend, navigation, responsive-layout, portal, result, and teaching-assignment areas identified from the current repository and recent Git history. It does not claim that every individual function or CSS rule requires separate documentation.
