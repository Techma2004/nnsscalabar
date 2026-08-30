# NNSS Calabar School Management System

A production-oriented school management platform for Nigerian Navy Secondary School, Calabar. The project now uses a single Node/Express application that serves the professional public website and the secure management portal, with MySQL/MariaDB persistence and server-side role enforcement.

## What was upgraded

- Replaced hard-coded `localhost` frontend API URLs with same-origin API calls.
- Replaced demo-style token storage with an HTTP-only authentication cookie.
- Added login rate limiting, security headers, graceful shutdown and database health checks.
- Added transactional account creation so failed role-specific setup cannot leave orphaned users.
- Added server-side validation and authorization for result uploads and HOD approvals.
- Fixed the result approval foreign-key bug: `approved_by` now receives the authenticated **users.id**, not `hods.id`.
- Result edits automatically revoke approval and create an audit entry.
- Added teacher assignment enforcement before score submission.
- Added automatic curriculum enrollment when a student account is created.
- Added automatic teacher subject/class assignments for the current academic session.
- Added real student, teacher, HOD, administrator and commandant portal workflows instead of placeholder dashboard panels.
- Added audience-aware announcements and management publishing.
- Removed demo passwords and the insecure committed `.env` file.
- Added a safe administrator bootstrap command using environment variables.
- Added a normalized database schema with curriculum mappings, audit logging and useful indexes.
- Improved portal presentation, responsive behavior, loading/error states and print-friendly result sheets.

## Architecture

```text
Browser
  │
  ▼
Node.js + Express
  ├── /api/auth
  ├── /api/admin
  ├── /api/students
  ├── /api/results
  ├── /api/announcements
  ├── /api/dashboard
  └── static frontend
          │
          ▼
      MySQL / MariaDB
```

The backend serves `frontend/`, so the production deployment can use one origin and does not require a second static HTTP server.

## Requirements

- Node.js 20+
- MySQL 8+ or MariaDB 10.6+
- npm

## Fresh local installation

### 1. Create the database

Create a database/user with credentials appropriate for your machine. Then import:

```bash
mysql -u nnss_user -p < database/schema.sql
```

The schema creates the database itself if the MySQL account has permission to do so.

### 2. Configure the backend

```bash
cd backend
cp .env.example .env
```

Edit `.env` and set a strong database password and a random `JWT_SECRET` of at least 32 characters.

### 3. Install dependencies

```bash
npm install
```

### 4. Create the first administrator

Set these values in `.env`:

```env
INITIAL_ADMIN_CODE=ADM001
INITIAL_ADMIN_PASSWORD=your-strong-password
INITIAL_ADMIN_NAME=NNSS System Administrator
INITIAL_ADMIN_EMAIL=admin@example.edu.ng
```

Then run:

```bash
npm run seed:admin
```

No default password is embedded in the source code.

### 5. Start the system

Development:

```bash
npm run dev
```

Production:

```bash
NODE_ENV=production npm start
```

Open `http://localhost:5000`.

## Accessing the portal over your local network

By default the server listens on every network interface (`HOST=0.0.0.0`), so any device on the same wifi/LAN as the host machine — a teacher's laptop, a lab PC, a phone on the school network — can reach the portal without any extra setup. When the server starts, it prints the exact address(es) to share:

```text
NNSS Calabar server listening on http://localhost:5000
Also reachable on this network at:
  http://192.168.1.42:5000
Share one of the addresses above with devices on the same wifi/LAN to let them use the portal.
```

Give that `http://192.168.x.x:5000` address to anyone on the same network — no app install, just a browser.

A few things to know:

- **Firewall**: make sure the host machine's firewall allows inbound connections on the chosen `PORT`.
- **HTTPS and login cookies**: secure cookies require HTTPS. Most school LANs don't have a TLS certificate, so if you run with `NODE_ENV=production` on a plain-HTTP LAN, set `COOKIE_SECURE=false` in `.env` — otherwise the browser will silently discard the login cookie and every sign-in will look like it worked but immediately act as logged out. Leave it unset (or `true`) only for a real HTTPS deployment.
- **CORS**: private/local-network addresses (`localhost`, `127.0.0.1`, `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`) are always allowed automatically. Use `FRONTEND_ORIGIN` only if you also need to allow a real public domain.
- **Restrict to one machine**: set `HOST=127.0.0.1` in `.env` if you specifically don't want other devices on the network to reach the server.

## Portal workflows

### Student

- Secure login
- Dashboard summary
- Approved results
- Curriculum subjects
- Announcements
- Profile
- Printable result sheet

### Teacher

- View current teaching assignments
- Select class/arm/subject
- Select assigned student
- Enter CA (0–30) and exam (0–70)
- Submit to HOD approval queue
- View assigned students

### HOD

- Department dashboard
- View pending results belonging to the HOD's department
- Approve results
- Department teacher directory
- Approved results become visible to students only after approval

### Administrator

- Live school statistics
- Create controlled accounts
- Student register, with lifecycle status (active / pending / withdrawn / graduated)
- Curriculum & subject management — add subjects, mark a subject as no longer offered, and assign subjects to a curriculum track
- Teacher directory
- Result oversight
- Publish announcements
- System/security overview

### Commandant

- School overview
- Live school statistics
- Top approved-result performers
- Curriculum & subject management
- Announcements

## Student lifecycle

A student's enrollment status is tracked independently of login access:

| Status | Meaning | Portal login |
|---|---|---|
| `active` | Currently attending | Allowed |
| `pending` | Admitted or returning, yet to resume | Blocked |
| `withdrawn` | Left the school permanently (transfer, expulsion, etc.) | Blocked |
| `graduated` | Completed studies; record retained | Blocked |

Changing status from the Students panel updates login access automatically and **never deletes** the student's account, admission record, or academic history — results, attendance, and every past record stay intact and queryable regardless of status. This is deliberate: a school register should never lose data, only reflect the student's current standing.

## Curriculum & subjects

Subjects are never hard-deleted either, for the same reason: existing results permanently reference them. From the admin/commandant **Curriculum** panel you can:

- Add a new subject (with its department, CA/exam maximums)
- Mark a subject as **no longer offered** — it disappears from new-assignment pickers (teacher assignment, account creation) but stays visible with its full history
- Re-offer a subject at any time
- Toggle which curriculum track (junior / science / technical / arts) teaches each subject

## Result lifecycle

```text
Teacher enters score
        │
        ▼
Server validates assignment + score limits
        │
        ▼
Result saved as Pending
        │
        ▼
HOD reviews department queue
        │
        ├── Approve ──► Student can view result
        │
        └── Teacher edits ──► Approval is reset + audit entry recorded
```

## Security notes

- Passwords are stored as bcrypt hashes.
- Authentication uses an HTTP-only cookie and an 8-hour JWT.
- Login attempts are rate-limited in-process.
- Sensitive authorization checks are performed on the server, not only in the UI.
- Students cannot request another student's results.
- Teachers can only upload for assigned class/arm/subject combinations.
- HODs can only approve results from their department.
- Locked terms cannot be edited or approved.
- Production HSTS is enabled when `NODE_ENV=production`.
- CORS automatically allows private-network origins (for LAN access) plus anything explicitly listed in `FRONTEND_ORIGIN`; nothing else.
- Secure, `httpOnly` cookies are used whenever `COOKIE_SECURE` resolves to true (see the LAN section above for when to turn this off).
- Do not commit `.env`, real passwords, database credentials or JWT secrets.

For multiple backend instances, replace the in-memory login limiter with a shared Redis-backed limiter.

## Deployment

The application is suitable for a VPS, Render-style Node host, a school's own LAN server, or a local school server. Set the production environment variables and use a managed MySQL/MariaDB service or a properly secured school database server.

For public hosting, terminate TLS at the hosting platform/reverse proxy and run the application with:

```bash
NODE_ENV=production npm start
```

For a LAN-only deployment (no public domain, no TLS), run with:

```bash
NODE_ENV=production COOKIE_SECURE=false npm start
```

## Important operational recommendation

Before live school use, management should load the **official** student register, staff register, class/arm assignments, subjects and academic calendar rather than relying on the baseline curriculum data in `database/schema.sql`. The Curriculum panel and Students panel (see above) are the supported way to keep this up to date as the school's offerings and enrollment change — through the admin UI, not by editing the database directly.

The schema is deliberately data-driven so these records can be maintained without rewriting application logic.

## Upgrading an existing database

Existing installations need one migration to pick up the student lifecycle-status feature (fresh installs get it automatically from `database/schema.sql`):

```bash
mysql -u <user> -p nnss_calabar < database/migrations/001_student_status.sql
```

This adds the `status`, `status_reason`, and `status_updated_at` columns to `students` and backfills anyone whose account was already deactivated as `withdrawn`, so existing data stays consistent.

## License

Proprietary school software. Intended for authorized use by NNSS Calabar and its development/administrative team.

## Optional AI Score-Sheet Import

AI is an optional assistant, not a dependency. The school portal, manual score entry, authentication, HOD approval and other workflows continue to work when the AI service is stopped or not installed.

### How it works

1. A teacher selects one of their assigned class/arm/subject assignments.
2. The teacher captures a clear score-sheet photo on a phone or uploads an image.
3. A local Ollama vision model reads the sheet and matches rows against the known school roster.
4. The teacher reviews and can edit every extracted CA/exam value.
5. The server validates the values and assignment again.
6. Results are saved as pending and must still be approved by the HOD.

The AI never publishes a result automatically. Uploaded images are processed in memory by the application and are not stored by the AI feature.

### Install Ollama (optional)

Install Ollama from its official distribution for your operating system, then verify it is running. The default model is `qwen3-vl:2b-instruct`. On a modest school/local machine, start with the 2B model. Larger vision models may require substantially more RAM.

Pull the model:

```bash
ollama pull qwen3-vl:2b-instruct
```

Configure the backend `.env`:

```env
AI_SCORE_IMPORT_ENABLED=true
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_VISION_MODEL=qwen3-vl:2b-instruct
OLLAMA_TIMEOUT_MS=90000
```

To disable AI while keeping the school system fully usable:

```env
AI_SCORE_IMPORT_ENABLED=false
```

When Ollama is stopped or the model is missing, the Teacher workspace displays an unavailable state and directs the teacher to manual score entry. It must not be treated as an application failure.

### Recommended image quality

Use a flat, well-lit sheet; keep all rows visible; avoid glare and motion blur; and photograph the page straight-on. Handwritten scores may require more manual verification than printed scores.

### Production safeguards

- AI extraction is a draft only.
- Student identity is matched against the selected class roster rather than trusted from the image alone.
- CA values are restricted to 0–30 and exam values to 0–70.
- Teacher verification is required before submission.
- Existing teacher-assignment and HOD-department authorization remains enforced.
- Manual entry remains the permanent fallback.
- Do not send real student records to third-party AI services without the school's authorization and appropriate privacy controls.

### HOD and teacher department selection

The management account form sends the selected department by its database ID. The backend also accepts department names for backward compatibility and normalizes matching case/whitespace. This prevents valid departments from being rejected when display names and stored values differ.

## Responsive UI hardening

The current build includes a final responsive/overflow pass for desktop, tablet and mobile layouts. Buttons and action groups wrap or stack instead of overflowing, navigation collapses on smaller screens, tables use controlled horizontal scrolling where tabular data cannot be safely collapsed, modals adapt to small screens, and long labels/content are allowed to wrap without widening the viewport.

When testing locally, verify at least these viewport widths in browser responsive mode: 1366px, 1024px, 768px, 520px, 390px and 360px. Check dashboard navigation, account management, score entry, AI score import, result approval, tables, dialogs and public pages.
