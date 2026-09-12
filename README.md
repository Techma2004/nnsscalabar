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
- Python 3.9+ with [uv](https://docs.astral.sh/uv/) installed — only needed for the Score-Sheet Scanner feature (see below); everything else runs without it. `tesseract-ocr` (the system OCR engine) must also be installed for the scanner to work.

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

## Score-Sheet Scanner (Tesseract OCR)

The scanner is an optional assistant, not a dependency. The school portal, manual score entry, authentication, HOD approval and other workflows continue to work when Tesseract is stopped or not installed.

Unlike a vision-language model, Tesseract OCR runs entirely on CPU with no GPU and no multi-gigabyte model to load — it's built specifically for a school server that can't run a model.

### How it works

1. A teacher selects one of their assigned class/arm/subject assignments.
2. The teacher captures a clear score-sheet photo on a phone or uploads an image.
3. The Node backend writes the image to a temporary file and runs `ocr_score_sheet.py` as a subprocess, passing it the real class roster (never a hardcoded one) over stdin.
4. The script runs Tesseract, reconstructs each row from the OCR'd words, and only returns a row when its student code matches a real roster entry — nothing is ever invented.
5. Each row's confidence score is Tesseract's own per-word OCR confidence, averaged across the row — not a fabricated number.
6. The teacher reviews and can edit every extracted CA/exam value before anything is saved.
7. The server independently re-validates the assignment, roster membership, and score ranges (0–30 / 0–70).
8. Results are saved as pending and must still be approved by the HOD, exactly like manual entry.

The scanner never publishes a result automatically. The uploaded image is written to a temp file only for the duration of the scan and is deleted immediately afterward, whether the scan succeeds or fails.

### Install Tesseract and uv (required for the scanner)

Python dependencies are managed with [uv](https://docs.astral.sh/uv/) rather than pip — it manages its own virtual environment and installs the dependencies declared in `pyproject.toml` automatically the first time the scanner runs, so there is no separate `pip install` step to remember.

```bash
sudo apt install tesseract-ocr tesseract-ocr-eng
curl -LsSf https://astral.sh/uv/install.sh | sh   # or: pip install uv --break-system-packages
```

That's it — no manual dependency install is required. The backend runs the scanner as `uv run ocr_score_sheet.py <image>`, and the first time that happens uv creates `.venv` and installs `pytesseract`/`Pillow` from `pyproject.toml` on its own (this first run takes a few extra seconds; every run after that is fast since the environment is cached on disk).

To avoid a slow-feeling *first* scan for whichever teacher happens to try it first, warm the environment once after installing:

```bash
uv sync
```

Configure the backend `.env`:

```env
AI_SCORE_IMPORT_ENABLED=true
OCR_RUNNER=uv
OCR_TIMEOUT_MS=20000
```

If a particular machine genuinely cannot have uv installed, fall back to a plain interpreter that already has the dependencies installed:

```bash
python3 -m venv .venv
.venv/bin/pip install pytesseract Pillow
```

```env
OCR_RUNNER=python
OCR_PYTHON_BIN=/full/path/to/nnsscalabar/.venv/bin/python3
```

To disable the scanner while keeping the rest of the school system fully usable:

```env
AI_SCORE_IMPORT_ENABLED=false
```

When Tesseract or the Python script is missing, the Teacher workspace displays an unavailable state and directs the teacher to manual score entry. This must not be treated as an application failure — check `GET /api/results/ai-status` to see what the server currently detects.

### Recommended image quality

Use a flat, well-lit sheet; keep all rows visible; avoid glare and motion blur; and photograph the page straight-on. Handwritten scores are read far less reliably than printed/typed ones — the scanner is tuned for typed score sheets. Rows that don't extract cleanly are simply omitted from the review table rather than guessed at; the teacher fills those in manually.

### Production safeguards

- OCR extraction is a draft only.
- Student identity is matched against the selected class roster rather than trusted from the image alone — a row is only ever returned when its code matches a real, currently-enrolled student.
- CA values are restricted to 0–30 and exam values to 0–70, checked independently on the server regardless of what the script reports.
- Teacher verification is required before submission.
- Existing teacher-assignment and HOD-department authorization remains enforced.
- Manual entry remains the permanent fallback.
- Processing is entirely local — no image or student data ever leaves the server.

### HOD and teacher department selection

The management account form sends the selected department by its database ID. The backend also accepts department names for backward compatibility and normalizes matching case/whitespace. This prevents valid departments from being rejected when display names and stored values differ.

## Password management

- **Self-service**: any signed-in user (any role) can change their own password from **My Profile**, by entering their current password plus a new one. Rate-limited to 10 attempts per 15 minutes per account.
- **Admin/commandant reset**: from **Account Management**, an admin or commandant can set a new password directly for any account — the only practical recovery path on a school LAN with no email/SMS infrastructure to run a self-service "forgot password" flow through. Resetting a management-level account (admin/commandant) is restricted to the Commandant, the same rule already used for account status changes. Every reset is written to `activity_log` for audit purposes.
- A password change takes effect immediately for new logins; it does not force out an already-active session on another device — the person should also sign out anywhere else they're logged in if the change was made because a password was compromised.

## Responsive UI hardening

The current build includes a final responsive/overflow pass for desktop, tablet and mobile layouts. Buttons and action groups wrap or stack instead of overflowing, navigation collapses on smaller screens, tables use controlled horizontal scrolling where tabular data cannot be safely collapsed, modals adapt to small screens, and long labels/content are allowed to wrap without widening the viewport.

When testing locally, verify at least these viewport widths in browser responsive mode: 1366px, 1024px, 768px, 520px, 390px and 360px. Check dashboard navigation, account management, score entry, the score-sheet scanner, result approval, tables, dialogs and public pages.
