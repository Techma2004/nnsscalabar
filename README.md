# NNSS Calabar School Management System

A production-oriented school management platform and public website for Nigerian Navy Secondary School, Calabar. It provides a responsive public website, role-based portals, academic result workflows, curriculum management, announcements, and an optional local score-sheet OCR assistant.

> Before production use, replace the sample academic data with the school's official register, staff records, assignments, academic calendar, and operational policies.

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/) [![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com/) [![MySQL](https://img.shields.io/badge/MySQL-8%2B-4479A1?logo=mysql&logoColor=white)](https://www.mysql.com/) [![Python](https://img.shields.io/badge/Python-3.9%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Installation](#installation)
- [Database setup](#database-setup)
- [MySQL access denied fix](#mysql-access-denied-fix)
- [Configuration](#configuration)
- [Create the first administrator](#create-the-first-administrator)
- [Run the application](#run-the-application)
- [Local-network access](#local-network-access)
- [Score-sheet OCR](#score-sheet-ocr-optional)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [License](#license)

## Features

- Public home, about, blog, newsletter, contact, responsive navigation, hero carousel, theme switching, and portal login.
- Single Node/Express application serving the API and `frontend/` from one origin.
- Student, teacher, HOD, administrator, and commandant portals.
- HTTP-only JWT authentication cookies, bcrypt password hashing, login rate limiting, security headers, CORS controls, health checks, and graceful shutdown.
- Student lifecycle states: `active`, `pending`, `withdrawn`, and `graduated`, while preserving academic history.
- Curriculum and subject management for junior, science, technical, and arts tracks.
- Teacher class/arm/subject assignments with server-side authorization.
- CA/examination result entry, generated totals, grades, remarks, HOD approval, revisions, and audit logging.
- Audience-aware announcements, printable result sheets, performance summaries, and attendance schema/views.
- Optional local Tesseract OCR score-sheet import with roster matching, confidence values, validation, teacher review, and manual fallback.

## Architecture

```text
Browser -> Node.js + Express -> MySQL/MariaDB
             ├── /api/auth
             ├── /api/admin
             ├── /api/students
             ├── /api/results
             ├── /api/announcements
             ├── /api/dashboard
             └── frontend/
```

## Requirements

### Required

- Node.js 20+ and npm
- MySQL 8+ or MariaDB 10.6+
- Git

### Optional OCR support

- Python 3.9+
- [uv](https://docs.astral.sh/uv/)
- Tesseract OCR with English language data

## Installation

Clone the repository:

```bash
git clone https://github.com/Techma2004/nnsscalabar.git
cd nnsscalabar
```

### Linux (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install -y git mysql-server nodejs npm
sudo apt install -y tesseract-ocr tesseract-ocr-eng  # optional OCR
curl -LsSf https://astral.sh/uv/install.sh | sh         # optional OCR
cd backend
npm install
cd ..
```

### macOS

Using Homebrew:

```bash
brew update
brew install node mysql git tesseract uv
brew services start mysql
cd backend
npm install
cd ..
```

Tesseract and uv are optional if OCR is not required.

### Windows

Install [Git for Windows](https://git-scm.com/download/win), [Node.js](https://nodejs.org/), and [MySQL Installer](https://dev.mysql.com/downloads/installer/). Then use PowerShell or Git Bash:

```powershell
git clone https://github.com/Techma2004/nnsscalabar.git
cd nnsscalabar
cd backend
npm install
cd ..
```

For OCR, install [Tesseract for Windows](https://github.com/UB-Mannheim/tesseract/wiki), add it to `PATH`, and install [uv](https://docs.astral.sh/uv/getting-started/installation/).

## Database setup

The consolidated `database/schema.sql` creates `nnss_calabar`, tables, seed academic records, indexes, views, and upgrade-safe blocks.

Create the database user as a MySQL/MariaDB administrator:

```bash
sudo mysql
```

```sql
CREATE DATABASE IF NOT EXISTS nnss_calabar
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'nnss_user'@'localhost'
  IDENTIFIED BY 'replace-with-a-strong-password';

GRANT ALL PRIVILEGES ON nnss_calabar.* TO 'nnss_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

Import the schema from the normal Linux terminal, not from inside the `MariaDB>` prompt:

```bash
mysql -u nnss_user -p nnss_calabar < database/schema.sql
```

You can also use MySQL Workbench by opening `database/schema.sql` and executing the complete script.

## MySQL access denied fix

If you see:

```text
ERROR 1045 (28000): Access denied for user 'test'@'localhost' (using password: YES)
```

or the same error for `temp` or another account, MySQL rejected the account/password or the account does not have permission. This is not a schema error.

Linux users and MySQL users are different. `sudo` gives operating-system privileges; it does not automatically grant database privileges to MySQL users such as `test` or `temp`.

Use the local MariaDB/MySQL administrator:

```bash
sudo mysql
```

Then use one consistent database and account name:

```sql
CREATE DATABASE IF NOT EXISTS nnss_calabar
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'nnss_admin'@'localhost'
  IDENTIFIED BY '1234#$';

GRANT ALL PRIVILEGES ON nnss_calabar.* TO 'nnss_admin'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

**Important:** the SQL password must be enclosed in single quotes. This is correct:

```sql
IDENTIFIED BY '1234#$';
```

This is incorrect:

```sql
IDENTIFIED BY 1234#$;
```

The earlier combination of creating `nnss_admin`, granting access to `nnss_school`, and importing into `nnss_school` uses inconsistent database names. This project uses `nnss_calabar` by default.

Test the account:

```bash
mysql -u nnss_admin -p -h 127.0.0.1 nnss_calabar
```

Then import:

```bash
mysql -u nnss_admin -p -h 127.0.0.1 nnss_calabar < database/schema.sql
```

If MySQL is stopped:

```bash
sudo systemctl start mysql
sudo systemctl status mysql
```

If the MariaDB prompt shows `->`, an SQL statement is unfinished. Cancel it with `\\c`, then use `EXIT;` to leave the prompt. Shell commands such as `mysql -u ... < database/schema.sql` must be run after returning to the Linux terminal.

## Configuration

Create the environment file:

```bash
cd backend
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `backend/.env`:

```dotenv
NODE_ENV=development
PORT=5000
HOST=0.0.0.0
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=nnss_admin
DB_PASSWORD='1234#$'
DB_NAME=nnss_calabar
DB_POOL_SIZE=10
JWT_SECRET='generate-a-random-secret-of-at-least-32-characters'
FRONTEND_ORIGIN=
TRUST_PROXY=false
COOKIE_SECURE=false
```

### Password quoting in `.env`

For passwords containing characters such as `#`, spaces, `;`, or shell-like symbols, enclose the value in single quotes in `.env`:

```dotenv
DB_PASSWORD='1234#$'
```

The quotes tell the dotenv parser that the complete value is the password. Do not add extra quotes around the password when entering it at the interactive `mysql -p` prompt; enter only the password itself. Never commit `.env` or real credentials.

Simple passwords may work without quotes, but quoting database passwords consistently avoids parsing problems. Use a long, unique password instead of the example `1234#$` outside local testing.

Other important settings:

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` or `production` |
| `PORT` | HTTP port; defaults to `5000` |
| `HOST` | `0.0.0.0` for LAN access, `127.0.0.1` for local-only access |
| `DB_HOST`, `DB_PORT` | Database connection address |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Database credentials and name |
| `DB_POOL_SIZE` | MySQL connection pool size |
| `JWT_SECRET` | At least 32 random characters |
| `FRONTEND_ORIGIN` | Additional permitted origins, comma-separated |
| `COOKIE_SECURE` | `true` with HTTPS; `false` for plain HTTP LAN testing |
| `AI_SCORE_IMPORT_ENABLED` | Enable/disable OCR |
| `OCR_RUNNER` | `uv` or `python` |
| `OCR_TIMEOUT_MS` | OCR timeout in milliseconds |

Generate a random JWT secret with:

```bash
openssl rand -base64 48
```

## Create the first administrator

Add these values to `backend/.env`:

```dotenv
INITIAL_ADMIN_CODE=ADM001
INITIAL_ADMIN_PASSWORD='use-a-strong-unique-password'
INITIAL_ADMIN_NAME='NNSS System Administrator'
INITIAL_ADMIN_EMAIL='admin@example.edu.ng'
```

From `backend/` run:

```bash
npm run seed:admin
```

No default administrator password is embedded in the source code.

## Run the application

From `backend/`:

```bash
npm run dev                 # development with automatic restart
NODE_ENV=production npm start
```

On Windows PowerShell:

```powershell
$env:NODE_ENV = "production"
npm start
```

Open:

- Website: `http://localhost:5000`
- Portal login: `http://localhost:5000/login.html`
- Health check: `http://localhost:5000/api/health`

## Local-network access

With `HOST=0.0.0.0`, the server prints LAN addresses at startup. Other devices on the same network can open an address such as:

```text
http://192.168.1.42:5000
```

Allow the port through the host firewall. For plain HTTP on a private LAN, use `COOKIE_SECURE=false`; secure cookies require HTTPS. Set `HOST=127.0.0.1` to prevent other devices from connecting. Do not expose a plain-HTTP installation directly to the public internet.

## Portal workflows

### Student

Secure login, dashboard, approved results, curriculum subjects, announcements, profile, and printable result sheets.

### Teacher

View assignments, select class/arm/subject, enter CA (0–30) and exam (0–70), submit to HOD approval, view assigned students, and optionally scan score sheets.

### HOD

Department dashboard, pending result review, approval, and department teacher directory. Students see results only after approval.

### Administrator

Statistics, controlled account creation, student lifecycle management, curriculum/subject management, teacher directory, result oversight, announcements, security overview, and supported password resets.

### Commandant

School overview, statistics, top approved-result performers, curriculum management, and announcements.

Result lifecycle:

```text
Teacher enters score -> server validates -> Pending result
    -> HOD approves -> student can view
    -> teacher edits -> approval resets and audit entry is recorded
```

## Score-sheet OCR (optional)

Install Tesseract and uv, then from the repository root:

```bash
uv sync
```

In `backend/.env`:

```dotenv
AI_SCORE_IMPORT_ENABLED=true
OCR_RUNNER=uv
OCR_TIMEOUT_MS=20000
```

The scanner runs locally, matches extracted codes against the real class roster, validates CA/exam ranges, and requires teacher review. It never publishes a result automatically. To disable it:

```dotenv
AI_SCORE_IMPORT_ENABLED=false
```

Fallback Python environment:

```bash
python3 -m venv .venv
.venv/bin/pip install pytesseract Pillow
```

```dotenv
OCR_RUNNER=python
OCR_PYTHON_BIN=/full/path/to/nnsscalabar/.venv/bin/python3
```

## Deployment

For production:

1. Provision Node.js 20+, MySQL/MariaDB, and persistent hosting.
2. Import `database/schema.sql`.
3. Create a production `.env` with unique credentials and a random JWT secret.
4. Create the first administrator and remove bootstrap secrets after use.
5. Terminate HTTPS at the hosting platform or reverse proxy.
6. Use `NODE_ENV=production` and `COOKIE_SECURE=true` with HTTPS.
7. Set `TRUST_PROXY=true` only behind a trusted reverse proxy.
8. Restrict database/firewall access, configure backups, and monitor logs.
9. Replace demo records with verified school data.

For an existing database, back it up first and apply the migration when required:

```bash
mysql -u <user> -p nnss_calabar < database/migrations/001_upgrade.sql
```

## Troubleshooting

### Database connection failed

Check that MySQL/MariaDB is running, credentials match `.env`, and the database exists:

```bash
mysql -h 127.0.0.1 -u nnss_admin -p nnss_calabar
```

### Login immediately logs out

For plain HTTP, set `COOKIE_SECURE=false`. Use `true` only with HTTPS.

### Other devices cannot connect

Confirm `HOST=0.0.0.0`, use the server LAN IP instead of `localhost`, allow port `5000` through the firewall, and verify both devices share the same network.

### OCR unavailable

Check `tesseract --version`, `uv --version`, and `python --version`. Run `uv sync`, or disable OCR and use manual entry.

### Results are not visible

Students see results only after an authorized HOD approves them. Check approval status, department, current term, and term lock state.

## Security

- Never commit `.env`, passwords, JWT secrets, or real student/staff data.
- Use HTTPS and secure cookies for public deployments.
- Use a unique production JWT secret of at least 32 characters.
- Restrict database privileges and network exposure.
- Back up the database and test restoration.
- Replace the in-memory login limiter with Redis for multiple backend instances.
- Treat OCR output as a draft requiring teacher verification and HOD approval.

## Contributing

Create a feature branch, keep secrets out of commits, test authentication/authorization/database/UI changes, document schema changes, and update this README when installation or operational behavior changes.

## License

Proprietary school software. Intended for authorized use by NNSS Calabar and its development/administrative team.
