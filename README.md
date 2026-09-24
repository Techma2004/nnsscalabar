# NNSS Calabar School Management System

A production-oriented school management platform and public school website for **Nigerian Navy Secondary School, Calabar**. The system combines a responsive public website, role-based academic portals, result approval workflows, announcements, curriculum management, and an optional local score-sheet OCR assistant.

> **Project status:** This repository is an active demo/application build. Before production use, replace sample academic data with the school's official register, staff records, assignments, academic calendar, and operational policies.

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![MySQL](https://img.shields.io/badge/MySQL-8%2B-4479A1?logo=mysql&logoColor=white)](https://www.mysql.com/)
[![Python](https://img.shields.io/badge/Python-3.9%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)

## Contents

- [Highlights](#highlights)
- [Technology stack](#technology-stack)
- [Repository structure](#repository-structure)
- [Requirements](#requirements)
- [Installation](#installation)
  - [Linux](#linux)
  - [macOS](#macos)
  - [Windows](#windows)
- [Database setup](#database-setup)
- [Configuration](#configuration)
- [Create the first administrator](#create-the-first-administrator)
- [Run the application](#run-the-application)
- [Local-network access](#local-network-access)
- [Features and workflows](#features-and-workflows)
- [Score-sheet OCR](#score-sheet-ocr-optional)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Security checklist](#security-checklist)
- [Contributing](#contributing)
- [License](#license)

## Highlights

- Public-facing NNSS Calabar website with responsive navigation, hero carousel, school information, blog/newsletter pages, quick links, theme switching, and portal login.
- Single Node.js/Express application that serves both the API and the `frontend/` directory from one origin.
- Role-based portals for students, teachers, HODs, administrators, and the commandant.
- Secure HTTP-only JWT authentication cookies, bcrypt password hashing, login rate limiting, security headers, CORS controls, and graceful shutdown.
- Student lifecycle management: `active`, `pending`, `withdrawn`, and `graduated` statuses without deleting academic history.
- Curriculum and subject administration with junior, science, technical, and arts tracks.
- Teacher subject/class/arm assignments and server-side authorization before score submission.
- Result entry with CA and examination scores, generated totals, grades, remarks, HOD approval, revision tracking, and audit logging.
- Audience-aware announcements and management publishing.
- Printable student result sheets and performance views.
- Optional local Tesseract OCR score-sheet assistant with roster matching, confidence values, score validation, teacher review, and manual-entry fallback.
- MySQL/MariaDB schema with academic sessions, terms, departments, subjects, users, students, teachers, HODs, results, attendance, announcements, activity logs, views, indexes, and safe upgrade blocks.

## Technology stack

| Area | Technology |
|---|---|
| Frontend | HTML, CSS, vanilla JavaScript |
| Backend | Node.js 20+, Express 4 |
| Database | MySQL 8+ or MariaDB 10.6+ |
| Authentication | JWT in HTTP-only cookies, bcryptjs |
| OCR assistant | Python 3.9+, Tesseract OCR, pytesseract, Pillow |
| Python environment | [uv](https://docs.astral.sh/uv/) |
| Development server | nodemon |

## Repository structure

```text
nnsscalabar/
├── backend/                 # Express API, authentication, database access, routes
│   ├── routes/              # Auth, admin, students, results, announcements, dashboard
│   ├── .env.example         # Backend configuration template
│   ├── db.js                # MySQL connection pool
│   ├── package.json
│   └── server.js            # API and frontend server entry point
├── frontend/                # Public website and portal UI
├── database/
│   ├── schema.sql           # Fresh-install schema, seed data, indexes, upgrade blocks
│   └── migrations/           # Standalone migration scripts for existing installations
├── ocr_score_sheet.py       # Optional Tesseract OCR extraction script
├── pyproject.toml           # Python OCR dependencies
├── uv.lock                  # Locked Python dependency versions
└── README.md
```

## Requirements

### Required for the school portal

- Node.js **20 or newer** and npm
- MySQL **8 or newer** or MariaDB **10.6 or newer**
- A database account that can create/use the `nnss_calabar` database, or an administrator who can import the schema
- Git, if installing from the repository

### Optional for score-sheet OCR

- Python **3.9 or newer**
- [uv](https://docs.astral.sh/uv/)
- Tesseract OCR and the English language data package

The OCR assistant is optional. Authentication, manual score entry, HOD approval, dashboards, announcements, and the public website continue to work when OCR is disabled or unavailable.

## Installation

Choose the instructions for your operating system. All commands should be run from the repository root unless a `cd backend` command is shown.

### 1. Clone the repository

```bash
git clone https://github.com/Techma2004/nnsscalabar.git
cd nnsscalabar
```

### Linux

Install Node.js, MySQL/MariaDB, Git, and the optional OCR tools using your distribution's package manager. For Ubuntu/Debian:

```bash
sudo apt update
sudo apt install -y git mysql-server nodejs npm
```

Check the installed versions:

```bash
node --version
npm --version
mysql --version
```

For OCR support:

```bash
sudo apt install -y tesseract-ocr tesseract-ocr-eng
curl -LsSf https://astral.sh/uv/install.sh | sh
# Restart your shell, or load the shell profile printed by the installer.
uv --version
```

Install application dependencies:

```bash
cd backend
npm install
cd ..
```

### macOS

Using [Homebrew](https://brew.sh/):

```bash
brew update
brew install node mysql git
brew services start mysql
```

Check the installed versions:

```bash
node --version
npm --version
mysql --version
```

For OCR support:

```bash
brew install tesseract
brew install uv
uv --version
```

Install application dependencies:

```bash
cd backend
npm install
cd ..
```

### Windows

1. Install:
   - [Git for Windows](https://git-scm.com/download/win)
   - [Node.js LTS](https://nodejs.org/)
   - [MySQL Installer for Windows](https://dev.mysql.com/downloads/installer/)
2. During MySQL installation, remember the root password and ensure the MySQL service is running.
3. Open PowerShell or Git Bash and clone the project:

```powershell
git clone https://github.com/Techma2004/nnsscalabar.git
cd nnsscalabar
```

Install Node dependencies:

```powershell
cd backend
npm install
cd ..
```

For optional OCR support:

1. Install [Tesseract for Windows](https://github.com/UB-Mannheim/tesseract/wiki) and add its installation directory, commonly `C:\Program Files\Tesseract-OCR`, to `PATH`.
2. Install [uv](https://docs.astral.sh/uv/getting-started/installation/) using the official Windows instructions.
3. Confirm both are available:

```powershell
tesseract --version
uv --version
```

If Tesseract is not on `PATH`, set `TESSERACT_CMD` only if the backend/scan environment supports it, or use the full executable path in your local OCR setup. Manual score entry remains available without OCR.

## Database setup

The consolidated schema is safe for a fresh database and contains the baseline academic data used by the demo.

### Option A: import with the MySQL client

Linux/macOS/Git Bash:

```bash
mysql -u root -p < database/schema.sql
```

Windows PowerShell:

```powershell
Get-Content .\database\schema.sql | mysql -u root -p
```

If the database user already exists and has permission to create the database, the script creates `nnss_calabar` automatically. Otherwise, create the database and application user first as a MySQL administrator:

```sql
CREATE DATABASE nnss_calabar CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'nnss_user'@'localhost' IDENTIFIED BY 'replace-with-a-strong-password';
GRANT ALL PRIVILEGES ON nnss_calabar.* TO 'nnss_user'@'localhost';
FLUSH PRIVILEGES;
```

Then import the schema with the new account:

```bash
mysql -u nnss_user -p nnss_calabar < database/schema.sql
```

### Option B: use MySQL Workbench

1. Open MySQL Workbench and connect to your local MySQL server.
2. Open `database/schema.sql`.
3. Execute the complete script.
4. Confirm that the `nnss_calabar` schema and its tables are visible.

The schema includes current academic session/term seed records, departments, subjects, class levels, arms, curriculum mappings, indexes, and reporting views. Replace or extend those records for the real school calendar.

## Configuration

Create the backend environment file:

```bash
cd backend
cp .env.example .env       # Linux/macOS/Git Bash
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `backend/.env` and set at least these values:

```dotenv
NODE_ENV=development
PORT=5000
HOST=0.0.0.0
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=nnss_user
DB_PASSWORD=replace-with-your-database-password
DB_NAME=nnss_calabar
DB_POOL_SIZE=10
JWT_SECRET=generate-a-random-secret-of-at-least-32-characters
FRONTEND_ORIGIN=
TRUST_PROXY=false
COOKIE_SECURE=false
```

### Environment variables

| Variable | Purpose | Notes |
|---|---|---|
| `NODE_ENV` | Runtime mode | Use `production` for live deployments |
| `PORT` | HTTP port | Defaults to `5000` |
| `HOST` | Network interface | `0.0.0.0` allows LAN access; use `127.0.0.1` for local-only access |
| `DB_HOST` / `DB_PORT` | Database address | Defaults to local MySQL settings |
| `DB_USER` / `DB_PASSWORD` | Database credentials | Never commit real values |
| `DB_NAME` | Database name | Normally `nnss_calabar` |
| `DB_POOL_SIZE` | MySQL pool size | Defaults to `10` |
| `JWT_SECRET` | Signs authentication tokens | Must be at least 32 characters; use a unique random secret |
| `FRONTEND_ORIGIN` | Additional permitted browser origins | Comma-separated; private-network origins are allowed automatically |
| `TRUST_PROXY` | Trust one reverse proxy | Set to `true` only when deployment requires it |
| `COOKIE_SECURE` | Require HTTPS for auth cookies | Use `true` with HTTPS; use `false` for a plain-HTTP school LAN |
| `INITIAL_ADMIN_*` | First administrator seed values | Used only by `npm run seed:admin` |
| `AI_SCORE_IMPORT_ENABLED` | Enable OCR assistant | Set to `false` to disable OCR |
| `OCR_RUNNER` | OCR process launcher | `uv` is recommended; `python` is the fallback |
| `OCR_PYTHON_BIN` | Python executable for fallback | Used when `OCR_RUNNER=python` |
| `OCR_TIMEOUT_MS` | Maximum scan duration | Defaults to `20000` milliseconds |

Generate a strong JWT secret rather than using an example value. For example, on Linux/macOS:

```bash
openssl rand -base64 48
```

On PowerShell:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

## Create the first administrator

Set these values in `backend/.env`:

```dotenv
INITIAL_ADMIN_CODE=ADM001
INITIAL_ADMIN_PASSWORD=use-a-strong-unique-password
INITIAL_ADMIN_NAME=NNSS System Administrator
INITIAL_ADMIN_EMAIL=admin@example.edu.ng
```

Run the seed command from `backend/`:

```bash
npm run seed:admin
```

The command creates the administrator if the code does not already exist. No default administrator password is embedded in the source code. After the first login, remove or replace the bootstrap values and keep the `.env` file private.

## Run the application

From `backend/`:

```bash
# Development; automatically restarts after server changes
npm run dev

# Production-style local run
NODE_ENV=production npm start
```

On Windows PowerShell, set the production variable for the current session like this:

```powershell
$env:NODE_ENV = "production"
npm start
```

Open the application at:

- Public website: `http://localhost:5000`
- Health check: `http://localhost:5000/api/health`
- Portal login: `http://localhost:5000/login.html`

A successful health check reports the API status and database connection. The server also logs the LAN addresses it detects at startup.

## Local-network access

The default `HOST=0.0.0.0` makes the application reachable from devices on the same Wi-Fi/LAN. Share the host machine's address, for example:

```text
http://192.168.1.42:5000
```

Important considerations:

- Allow inbound TCP traffic on the selected port in the host firewall.
- For a plain-HTTP LAN deployment, set `COOKIE_SECURE=false`; secure cookies require HTTPS.
- Private origins such as `localhost`, `127.0.0.1`, `10.x.x.x`, `172.16.x.x–172.31.x.x`, and `192.168.x.x` are allowed automatically.
- Set `FRONTEND_ORIGIN` for a public domain or another explicitly trusted origin.
- Set `HOST=127.0.0.1` when the service must be accessible only on the server itself.
- Do not expose a plain-HTTP school installation directly to the public internet.

## Features and workflows

### Public website

- Home page with responsive navigation and hero carousel
- About, blog, newsletter, and contact information sections
- Quick links to academic records, staff workspace, latest news, and school information
- Theme toggle and mobile navigation
- Responsive layouts for desktop, tablet, and mobile screens

### Student portal

- Secure login and profile access
- Dashboard summary and announcements
- Curriculum subjects and enrollment information
- Approved results only
- Printable result sheet
- Access automatically blocked when lifecycle status is `pending`, `withdrawn`, or `graduated`

### Teacher portal

- View current teaching assignments
- Select assigned class, arm, and subject
- Select an enrolled student
- Enter CA scores from 0–30 and examination scores from 0–70
- Submit results to the HOD approval queue
- View assigned students
- Optionally scan a score sheet and review extracted values before submission

### HOD portal

- Department dashboard and teacher directory
- Review pending results belonging to the HOD's department
- Approve results after review
- Approved results become visible to students
- Teacher revisions revoke approval and create an audit entry

### Administrator portal

- Live school statistics and system/security overview
- Controlled account creation for students, teachers, HODs, administrators, and commandants
- Student register and lifecycle status management
- Curriculum and subject management
- Teacher directory and assignment oversight
- Result oversight
- Audience-aware announcement publishing
- Password reset for supported management workflows

### Commandant portal

- School overview and live statistics
- Approved-result performance summaries and top performers
- Curriculum and subject management
- Announcements

### Result lifecycle

```text
Teacher enters score
        │
        ▼
Server validates assignment, enrollment, term, and score limits
        │
        ▼
Result is saved as Pending
        │
        ▼
HOD reviews the department queue
        │
        ├── Approve ──► Student can view the result
        │
        └── Teacher edits ──► Approval resets and an audit entry is recorded
```

## Score-sheet OCR (optional)

The scanner is a local assistant powered by Tesseract. It does not publish results automatically and does not replace teacher review or HOD approval.

### Install and enable OCR

Install Tesseract and uv using the platform instructions above, then from the repository root run:

```bash
uv sync
```

Set the following in `backend/.env`:

```dotenv
AI_SCORE_IMPORT_ENABLED=true
OCR_RUNNER=uv
OCR_TIMEOUT_MS=20000
```

The backend runs the scanner with the real class roster and the script returns only rows whose student code matches that roster. It validates CA values against 0–30 and examination values against 0–70, but the teacher must review and confirm every extracted value.

To use an already-installed Python environment instead of uv:

```bash
python3 -m venv .venv
.venv/bin/pip install pytesseract Pillow
```

Then configure:

```dotenv
AI_SCORE_IMPORT_ENABLED=true
OCR_RUNNER=python
OCR_PYTHON_BIN=/full/path/to/nnsscalabar/.venv/bin/python3
```

On Windows, use the equivalent interpreter path, for example:

```dotenv
OCR_PYTHON_BIN=C:\path\to\nnsscalabar\.venv\Scripts\python.exe
```

Disable OCR without affecting the rest of the platform:

```dotenv
AI_SCORE_IMPORT_ENABLED=false
```

For best results, use a flat, well-lit score sheet, keep all rows visible, avoid glare and motion blur, and photograph the page straight-on. Printed or typed scores are generally more reliable than handwriting.

## Deployment

The application can run on a school LAN server, VPS, or managed Node hosting platform with a managed MySQL/MariaDB service.

### Production checklist

1. Provision Node.js 20+, MySQL/MariaDB, and a persistent server or managed host.
2. Clone the repository and run `npm install` inside `backend/`.
3. Import `database/schema.sql` into the production database.
4. Create a production `.env` with unique credentials and a strong `JWT_SECRET`.
5. Create the initial administrator and change the bootstrap password/configuration.
6. Terminate HTTPS at the hosting platform or reverse proxy.
7. Set `NODE_ENV=production`, `COOKIE_SECURE=true`, and `TRUST_PROXY=true` only when a trusted reverse proxy is actually in use.
8. Restrict database access and firewall rules to the application host where possible.
9. Configure backups, monitoring, log rotation, and a process supervisor such as systemd, Docker, or the host's native service manager.
10. Replace all demo records with verified school data before allowing real users to sign in.

Start the production server with:

```bash
NODE_ENV=production npm start
```

For a LAN-only installation without TLS:

```bash
NODE_ENV=production COOKIE_SECURE=false npm start
```

For an existing installation, apply the standalone migration when required:

```bash
mysql -u <user> -p nnss_calabar < database/migrations/001_upgrade.sql
```

The consolidated `database/schema.sql` also contains upgrade-safe blocks, but take a database backup before changing an existing production database.

## Troubleshooting

### `JWT_SECRET must be set and at least 32 characters long`

Set a random `JWT_SECRET` in `backend/.env`, restart the server, and ensure the file is being loaded from the `backend/` directory.

### Database connection failed

Check that MySQL/MariaDB is running, the host/port are correct, the database exists, and `DB_USER`, `DB_PASSWORD`, and `DB_NAME` match the imported schema. Test independently:

```bash
mysql -h 127.0.0.1 -u nnss_user -p nnss_calabar
```

### Login succeeds but immediately appears logged out

If the server is running over plain HTTP, set `COOKIE_SECURE=false`. Use `COOKIE_SECURE=true` only when the browser reaches the application through HTTPS.

### Other devices cannot open the portal

Confirm `HOST=0.0.0.0`, use the server's LAN IP rather than `localhost`, allow the port through the firewall, and verify that both devices are on the same network.

### OCR is unavailable

Confirm `tesseract --version`, `uv --version`, and `python --version`. Run `uv sync` from the repository root. If OCR remains unavailable, set `AI_SCORE_IMPORT_ENABLED=false` and use manual entry.

### Existing users cannot see a result

Results remain hidden from students until a permitted HOD approves them. Check the result's approval status, HOD department, current term, and whether the term is locked.

## Security checklist

- Never commit `.env`, database passwords, JWT secrets, or real student/staff data.
- Use HTTPS for public deployments and set secure cookies.
- Use a unique production `JWT_SECRET` of at least 32 characters.
- Limit database privileges and network exposure.
- Keep Node.js, MySQL/MariaDB, Tesseract, and operating-system packages updated.
- Back up the database and test restoration before live school use.
- Use a shared Redis-backed rate limiter if running multiple backend instances; the included limiter is in-process.
- Review audit logs and administrative accounts regularly.
- Treat OCR output as a draft and require teacher verification plus HOD approval.

## Contributing

1. Create a feature branch from `main`.
2. Keep secrets and real school data out of commits.
3. Test API, authentication, role authorization, database changes, and responsive layouts before opening a pull request.
4. Document schema changes and update this README when installation or operational behavior changes.
5. Use clear commit messages and include screenshots for significant UI changes.

## License

Proprietary school software. Intended for authorized use by NNSS Calabar and its development/administrative team.
