# NNSS Calabar School Management System

A web-based school management platform and public website for Nigerian Navy Secondary School, Calabar. The application includes role-based portals for the Commandant, administrators, Heads of Department (HODs), teachers, and students; academic result entry and approval; curriculum and account management; announcements; and optional local score-sheet OCR.

> **Before real school use:** replace sample/demo records with verified school data, review account permissions and school workflows, configure HTTPS, and establish database backups. Do not use real student information over plain HTTP.

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/) [![Express](https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white)](https://expressjs.com/) [![MySQL](https://img.shields.io/badge/MySQL-8%2B-4479A1?logo=mysql&logoColor=white)](https://www.mysql.com/) [![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)

## Documentation

- **[Windows Setup Guide](WINDOWS_SETUP.md)** — complete beginner-friendly Windows/PowerShell install: Node.js, Git, MySQL, uv and Tesseract, PATH fixes, database, `.env`, running and backups.
- **[Configuration Reference](CONFIGURATION.md)** — every `backend/.env` setting, built-in limits, and example configurations.
- **[FAQ](FAQ.md)** — fixes for the most common errors (not recognized, 1045, login loops, scanner, backups).
- **[Fresh install on a new PC](FRESH_INSTALL.md)** — the short version.
- **[Portal User Guide](PORTAL_GUIDE.md)** — step-by-step usage instructions for Commandant, Admin, HOD, teachers, and students.
- **[Security Policy](SECURITY.md)** — security controls, safe deployment requirements, and vulnerability reporting.
- **[License](LICENSE)** — proprietary-use terms. This repository is **not open source**.

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Installation at a glance](#installation-at-a-glance)
- [Install on Linux](#1-install-on-linux)
- [Install on macOS](#2-install-on-macos)
- [Install on Windows](#3-install-on-windows)
- [Create the database](#create-the-database)
- [Configure the application](#configure-the-application)
- [Create the first management account](#create-the-first-management-account)
- [Start and open the portal](#start-and-open-the-portal)
- [Optional score-sheet OCR](#optional-score-sheet-ocr)
- [Existing database and roster tools](#existing-database-and-roster-tools)
- [Production deployment checklist](#production-deployment-checklist)
- [Troubleshooting](#troubleshooting)
- [Testing](#testing)
- [License and security](#license-and-security)

## Features

- Responsive public website, news/blog pages, newsletter/contact pages, theme switching, and portal sign-in.
- One Node.js/Express application serves both the API and `frontend/` from the same origin.
- Five account roles: `commandant`, `admin`, `hod`, `teacher`, and `student`.
- HTTP-only JWT session cookie, bcrypt password hashing, login throttling, request rate limits, security headers, origin checks, and server-side role/assignment authorization.
- Student lifecycle statuses, including active, pending, withdrawn, graduated, and repeating, with academic history retained.
- Curriculum, departments, subjects, class levels, arms, academic sessions, and terms.
- Teacher class/arm/subject assignments.
- Continuous-assessment score sheets, generated totals/grades/remarks, HOD approval, return-for-correction workflow, and activity logging.
- Excel score-sheet import/export, printable results, optional report-card statistics, and optional local Tesseract OCR for photos/PDFs.
- Audience-aware announcements, dashboards, health endpoint, and graceful shutdown.

## Architecture

```text
Browser
  └── Node.js + Express (frontend + /api)
        ├── Authentication and role checks
        ├── Student / staff / results / assignments / announcements / dashboard routes
        └── MySQL or MariaDB
```

The application is served from one origin. For local development, the default address is `http://localhost:5000`; no separate frontend development server is required.

## Requirements

### Required

- **Node.js 20 or newer** (use an active LTS release) and npm.
- **MySQL 8+ or MariaDB 10.6+**.
- Git.
- A modern browser.

### Optional: score-sheet OCR

- Python 3.10+.
- [uv](https://docs.astral.sh/uv/).
- Tesseract OCR and its English language data.
- PDF scanning additionally uses the Python dependencies declared by this repository.

If OCR is not needed, you can skip all optional OCR dependencies and use manual or Excel score entry.

## Installation at a glance

1. Install Node.js, Git, and MySQL/MariaDB for your operating system.
2. Clone this repository.
3. Create the `nnss_calabar` database and a dedicated database user.
4. Import `database/schema.sql`.
5. Create `backend/.env` from `backend/.env.example` and set real credentials and a JWT secret.
6. Install backend dependencies with `npm install`.
7. Create the first Commandant or administrator account.
8. Start the server and open `http://localhost:5000/login.html`.

Follow the operating-system section below before continuing to [Create the database](#create-the-database).

## 1. Install on Linux

Examples below target Ubuntu/Debian. Other Linux distributions need equivalent packages and service commands.

### Step 1 — Install Git, a database server, and supporting tools

```bash
sudo apt update
sudo apt install -y git curl ca-certificates default-mysql-server
```

On Debian, `default-mysql-server` commonly installs MariaDB, which is supported. If you already run MySQL/MariaDB, do not install a second database server.

### Step 2 — Install Node.js 20+

Use an active LTS version from the official Node.js distribution or a version manager. Do not assume the distribution's `nodejs` package is new enough.

For example, with [nvm](https://github.com/nvm-sh/nvm):

```bash
# Follow the current installation instructions at https://github.com/nvm-sh/nvm
# in your normal user account, then:
nvm install --lts
nvm use --lts
node --version
npm --version
```

Confirm that `node --version` reports v20 or newer.

### Step 3 — Start the database service

Run **one** command, matching the database you installed:

```bash
# MariaDB (common on Debian)
sudo systemctl enable --now mariadb
```

For Oracle MySQL instead:

```bash
sudo systemctl enable --now mysql
```

Confirm that the selected service is running before continuing.

### Step 4 — Clone the project and install Node dependencies

```bash
git clone https://github.com/Techma2004/nnsscalabar.git
cd nnsscalabar
cd backend
npm install
cd ..
```

### Step 5 — Continue

Follow [Create the database](#create-the-database), [Configure the application](#configure-the-application), and [Create the first management account](#create-the-first-management-account).

Optional OCR packages:

```bash
sudo apt install -y tesseract-ocr tesseract-ocr-eng
```

Install `uv` using the official [uv installation guide](https://docs.astral.sh/uv/getting-started/installation/) only if you plan to use OCR.

## 2. Install on macOS

These steps use [Homebrew](https://brew.sh/). If you do not have Homebrew, install it using the instructions on its official website first.

### Step 1 — Install dependencies

Open Terminal:

```bash
brew update
brew install git node mysql
node --version
npm --version
mysql --version
```

Confirm Node.js is v20 or newer. If Homebrew supplies an older version in your environment, install an active LTS version from [nodejs.org](https://nodejs.org/) or use a Node version manager.

### Step 2 — Start MySQL

```bash
brew services start mysql
```

Homebrew MySQL installations may initially allow local administrative access without a password, depending on how they were initialized. Use the account and password configured on your own machine when creating the application database.

### Step 3 — Clone the project and install Node dependencies

```bash
git clone https://github.com/Techma2004/nnsscalabar.git
cd nnsscalabar
cd backend
npm install
cd ..
```

### Step 4 — Continue

Follow [Create the database](#create-the-database), [Configure the application](#configure-the-application), and [Create the first management account](#create-the-first-management-account).

Optional OCR packages:

```bash
brew install tesseract uv
```

OCR is optional; do not install these packages unless you need score-sheet scanning.

## 3. Install on Windows

> **New to Windows setup?** Follow the full guide: **[WINDOWS_SETUP.md](WINDOWS_SETUP.md)**. It explains installs, PATH, and what to do when PowerShell says a program is not recognized. The summary below is the short version.

Use a supported 64-bit Windows version and open **PowerShell** or **Windows Terminal**.

### Step 1 — Install the required software

Install these from their official download pages:

- [Git for Windows](https://git-scm.com/download/win)
- [Node.js LTS](https://nodejs.org/) — choose a release that is v20 or newer and includes npm.
- [MySQL Installer](https://dev.mysql.com/downloads/installer/) — install MySQL Server. MySQL Workbench is useful but optional.

**Close PowerShell and open a new window after every install** so updated PATH entries are loaded. The MySQL and Tesseract installers do **not** add themselves to PATH; see [WINDOWS_SETUP.md](WINDOWS_SETUP.md).

Verify:

```powershell
git --version
node --version
npm --version
mysql --version
```

If PowerShell says `mysql` is not recognized, add the MySQL Server `bin` directory to PATH or use the full path to `mysql.exe` for database commands.

### Step 2 — Start MySQL

Use **Services** in Windows to confirm that the MySQL service is running, or start it from the MySQL Installer. Remember the MySQL administrative password chosen during installation.

### Step 3 — Clone the project and install Node dependencies

```powershell
git clone https://github.com/Techma2004/nnsscalabar.git
cd nnsscalabar
cd backend
npm install
cd ..
```

### Step 4 — Continue

Follow [Create the database](#create-the-database), [Configure the application](#configure-the-application), and [Create the first management account](#create-the-first-management-account).

Optional OCR on Windows:

- Install [Tesseract OCR for Windows](https://github.com/UB-Mannheim/tesseract/wiki) and ensure `tesseract.exe` is on PATH.
- Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and a supported Python version if you intend to scan score sheets.

## Create the database

Create a dedicated application database user. Do not run the web application as the database root/administrator account.

### Step 1 — Open a database administrator session

Choose the command for your system:

**Linux (typical local MariaDB installation):**

```bash
sudo mariadb
```

If your system uses MySQL, `sudo mysql` may be the correct command.

**macOS:**

```bash
mysql -u root -p
```

If your local Homebrew setup uses passwordless root access, omit `-p`. If root login is not available, use the database administrator account configured during installation.

**Windows PowerShell:**

```powershell
mysql -u root -p
```

Enter the MySQL administrator password when prompted. The prompt should change to something like `mysql>`.

### Step 2 — Create the database and application user

Run this SQL inside the MySQL/MariaDB prompt. Replace the example password with a long, unique password. Keep the single quotes around the SQL password.

```sql
CREATE DATABASE IF NOT EXISTS nnss_calabar
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'nnss_user'@'localhost'
  IDENTIFIED BY 'replace-with-a-long-unique-password';
CREATE USER IF NOT EXISTS 'nnss_user'@'127.0.0.1'
  IDENTIFIED BY 'replace-with-a-long-unique-password';

GRANT ALL PRIVILEGES ON nnss_calabar.* TO 'nnss_user'@'localhost';
GRANT ALL PRIVILEGES ON nnss_calabar.* TO 'nnss_user'@'127.0.0.1';
FLUSH PRIVILEGES;
EXIT;
```

The two host entries allow the app's default `DB_HOST=127.0.0.1` and local socket-based MySQL commands to use the same account name. Use the same unique password for both entries. If an account already exists and its password is unknown, update it intentionally with `ALTER USER` rather than assuming `CREATE USER IF NOT EXISTS` changed its password.

### Step 3 — Import the schema

Run these commands from the repository root (the folder containing `database/`), **not inside** the `mysql>` prompt.

**Linux and macOS:**

```bash
mysql -u nnss_user -p nnss_calabar < database/schema.sql
```

**Windows PowerShell:**

```powershell
mysql -u root -p -e "SOURCE database/schema.sql"
```

PowerShell has no `<` operator, so use `SOURCE`. Use forward slashes and do not quote the path. The schema creates the `nnss_calabar` database itself and works on MySQL 8 and MariaDB 10.6+. If PowerShell cannot find `mysql`, see [WINDOWS_SETUP.md](WINDOWS_SETUP.md) or use the full path to `mysql.exe`. When prompted, enter the password of the account you named after `-u`.

The consolidated `database/schema.sql` creates the database tables and reference/seed data used by the application. The repository also contains migration scripts for particular existing installations; see [Existing database and roster tools](#existing-database-and-roster-tools) before applying a migration to a database that already contains data.

## Configure the application

### Step 1 — Create the environment file

From the repository root:

**Linux/macOS:**

```bash
cp backend/.env.example backend/.env
```

**Windows PowerShell:**

```powershell
Copy-Item backend/.env.example backend/.env
```

### Step 2 — Edit `backend/.env`

Open the file in your preferred text editor and set the database user/password to match the account created above. The essential local-development settings should look similar to:

```dotenv
NODE_ENV=development
PORT=5000
HOST=127.0.0.1
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=nnss_user
DB_PASSWORD='replace-with-your-actual-database-password'
DB_NAME=nnss_calabar
DB_POOL_SIZE=10
JWT_SECRET=replace-this-with-a-random-secret
FRONTEND_ORIGIN=
TRUST_PROXY_HOPS=0
COOKIE_SECURE=false
```

- Replace **every** placeholder, especially `DB_PASSWORD` and `JWT_SECRET`. The server intentionally refuses to start with known placeholder values or a JWT secret shorter than 32 characters.
- If the database password contains `#` or spaces, quote it in `.env`; avoid passwords containing a literal single quote when using single-quoted dotenv values.
- Keep `HOST=127.0.0.1` for this computer only. Use `0.0.0.0` only when deliberately enabling same-network/LAN access.
- `COOKIE_SECURE=false` is for isolated local testing with synthetic data only. Real school data requires HTTPS and `COOKIE_SECURE=true`.
- Leave `FRONTEND_ORIGIN` empty for a normal local install. It is for additional explicitly permitted origins.
- Keep `TRUST_PROXY_HOPS=0` for direct local connections. Only change it to the verified proxy hop count behind a trusted reverse proxy.

### Step 3 — Generate a strong JWT secret

Run this from any terminal where Node.js is installed. The same command works in PowerShell, macOS, and Linux:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Copy the generated value into `JWT_SECRET` in `backend/.env`. Do not share it or commit it to Git. Keep `.env` private.

## Create the first management account

Choose **one** bootstrap account to start with. For a fresh school installation, creating the Commandant first is convenient because the Commandant can create administrator and Commandant accounts through Account Management.

### Option A — Create the first Commandant

Add or edit these values in `backend/.env`:

```dotenv
INITIAL_COMMANDANT_CODE=CMD001
INITIAL_COMMANDANT_PASSWORD='use-a-strong-unique-password'
INITIAL_COMMANDANT_NAME='The Commandant'
INITIAL_COMMANDANT_EMAIL=
```

Choose a unique ID and password for the actual operator. Then run:

```bash
cd backend
npm run seed:commandant
cd ..
```

### Option B — Create the first administrator

Instead, configure these values in `backend/.env`:

```dotenv
INITIAL_ADMIN_CODE=ADM001
INITIAL_ADMIN_PASSWORD='use-a-strong-unique-password'
INITIAL_ADMIN_NAME='NNSS System Administrator'
INITIAL_ADMIN_EMAIL=
# optional: admin (default) or commandant
INITIAL_ADMIN_ROLE=admin
```

`INITIAL_ADMIN_ROLE` chooses the role of the account that `seed:admin` creates: `admin` (default) or `commandant`.

Then run:

```bash
cd backend
npm run seed:admin
cd ..
```

Use PowerShell equivalents for changing directories if needed. The seed scripts read `backend/.env` and connect to the database configured there. The seed scripts can update an account if the same user ID already exists, so run them deliberately and protect the credentials.

After successfully creating the bootstrap account, remove or replace the bootstrap password values in `backend/.env` and store credentials securely. Do not commit the environment file.

## Start and open the portal

### Development mode

From the repository root:

```bash
cd backend
npm run dev
```

This uses Node's watch mode and restarts the server when backend files change.

### Normal mode

Stop the development server with `Ctrl+C`, then from `backend/` run:

```bash
npm start
```

For a production-mode smoke check, configure HTTPS first and then set `NODE_ENV=production` and `COOKIE_SECURE=true` in the environment. Do not expose a production-mode server over plain HTTP.

### Open these addresses

- Public website: [http://localhost:5000](http://localhost:5000)
- Portal sign-in: [http://localhost:5000/login.html](http://localhost:5000/login.html)
- API health check: [http://localhost:5000/api/health](http://localhost:5000/api/health)

The health endpoint reports whether the API can reach the database. It does not replace a full backup/restore check or deployment review.

### Use the portal from another device on the same network

1. Stop the server.
2. Set `HOST=0.0.0.0` in `backend/.env`.
3. Restart the server and note the LAN address printed in the terminal.
4. Allow inbound port `5000` through the computer's firewall only on the trusted private network.
5. From another device on the same network, open `http://<server-LAN-IP>:5000/login.html`.

**LAN warning:** plain HTTP is not safe for real student records, even on a private Wi-Fi network. Use synthetic data for a local demonstration. For real data, configure HTTPS, set `COOKIE_SECURE=true`, and restrict access to trusted users and networks.

## Optional score-sheet OCR

OCR is optional. Teachers can use Score Sheet, Manual Entry, or Excel import without enabling OCR.

### Install the OCR tools

Install Tesseract and English language data using your operating system's package manager/installer. Install [uv](https://docs.astral.sh/uv/getting-started/installation/), then from the repository root run:

```bash
uv sync
```

In `backend/.env`, set:

```dotenv
AI_SCORE_IMPORT_ENABLED=true
OCR_RUNNER=uv
OCR_TIMEOUT_MS=60000
```

Restart the server after changing environment values. Check the scanner's status in the teacher portal. The scanner runs locally using Tesseract; it is OCR, not a hosted generative-AI service. It matches extracted text to the roster, validates score ranges, and requires a teacher to review and confirm entries. It never publishes results directly.

If OCR is unavailable, select Manual Entry or use the score-sheet grid. To disable scanning:

```dotenv
AI_SCORE_IMPORT_ENABLED=false
```

The fallback `OCR_RUNNER=python` mode requires `OCR_PYTHON_BIN` to point to a Python interpreter with the project's OCR dependencies installed. Use the documented `uv` workflow unless there is a specific reason not to.

## Existing database and roster tools

**Back up an existing database before running any schema, migration, import, or upgrade command.** Do not re-import the initial schema over a live school database without reviewing its SQL.

Migration files are version-specific. The repository includes `database/002_result_rejection.sql`, `database/003_promotion_and_departments.sql`, `database/004_ca_sheet_scheme.sql`, `database/005_session_version.sql` and `database/006_news_team_requests_contacts.sql` (adds the news-team role, blog/newsletter posts and student change requests). All of them are already included in `database/schema.sql`, so a new installation needs none of them (see [FRESH_INSTALL.md](FRESH_INSTALL.md)). Apply only the migration(s) required by your current schema, in the order intended for that installation. If you are unsure which version is installed, stop and inspect the schema rather than running every SQL file blindly.

### Importing the included scanned-sheet rosters

The file `database/rosters/2025-2026-second-term.json` contains transcribed names for SS1 SIRI and JSS3 AYAM. It is roster data, not score data. Review it against the official register before use.

From the repository root:

```bash
node database/import-rosters.js
node database/import-rosters.js --apply
```

The first command is a dry run; the second writes records. Temporary imported credentials are written to a git-ignored file. Protect and securely dispose of that file after authorized delivery. Use `--mirror-assignments` only when you deliberately want to copy teaching assignments from the current session.

## Production deployment checklist

Before a live deployment:

1. Use supported Node.js and MySQL/MariaDB versions and persistent hosting.
2. Use a dedicated least-privilege database account; do not run the application as database root.
3. Import or migrate the schema after taking a verified backup.
4. Replace all demo records with verified school data and review user/teacher assignments.
5. Generate a unique random `JWT_SECRET` of at least 32 characters.
6. Set `NODE_ENV=production`, terminate HTTPS at the application host or a correctly configured reverse proxy, and set `COOKIE_SECURE=true`.
7. Set `TRUST_PROXY_HOPS` to the exact, verified proxy hop count. Use `0` for direct connections. Never enable unrestricted proxy trust; the trusted proxy must overwrite forwarded headers.
8. Keep `.env`, bootstrap credentials, imported credentials, backups, and student data out of Git and public storage.
9. Restrict network access to the web server and database; enable monitoring and tested backups.
10. Run the targeted backend test suite and verify sign-in, each role's access, result approval, and restoration procedures before go-live.
11. For multiple backend instances, replace the in-memory rate-limit stores with a shared store such as Redis.
12. Review [SECURITY.md](SECURITY.md) and the [License](LICENSE) before operating or redistributing the software.

Never expose a plain-HTTP installation containing real student or staff information to the public internet.

## Troubleshooting

More answers are in the **[FAQ](FAQ.md)**; every setting is explained in **[CONFIGURATION.md](CONFIGURATION.md)**.

### `node` or `npm` is not recognized

Install Node.js 20+ and reopen the terminal. On Windows, confirm the Node.js installation directory is on PATH.

### `mysql` is not recognized

The database client may not be on PATH. On Windows, use the full path to `mysql.exe` or add the MySQL Server `bin` directory to PATH. On macOS, confirm Homebrew installed MySQL and that its `bin` directory is available.

### Database access denied (MySQL error 1045)

The database rejected the account/password or the account lacks permission. This is not necessarily a schema error. Confirm that:

- `DB_USER`, `DB_PASSWORD`, `DB_HOST`, and `DB_NAME` in `backend/.env` match the database account you created.
- The SQL account has privileges on `nnss_calabar.*`.
- The SQL password was quoted in the SQL statement and is entered without extra quote characters at the interactive password prompt.
- You are connecting to the same database service where you created the user.

On Linux, `sudo` is an operating-system privilege and does not automatically grant a MySQL account named `test`, `temp`, or another username database access.

### Server exits immediately and mentions `JWT_SECRET` or `DB_PASSWORD`

Edit `backend/.env` and replace the placeholders with a random JWT secret and the actual dedicated database password. The application deliberately rejects placeholder values.

### Portal sign-in does not stay logged in

For local-only HTTP testing with synthetic data, set `COOKIE_SECURE=false` in `backend/.env` and restart the server. For real data, configure HTTPS and `COOKIE_SECURE=true` instead; do not weaken cookie security on a live deployment.

### Another device cannot open the portal

Set `HOST=0.0.0.0`, use the server's LAN IP rather than `localhost`, check that both devices are on the same network, and allow the port through the host firewall. Do not expose the server to the public internet just to solve a LAN connectivity issue.

### Results are not visible to a student

Students can view results after the HOD approval workflow completes. Confirm the correct term/session, the teacher's class/arm/subject assignment, and the sheet's approval status. A returned or pending result is not a published result.

### OCR is unavailable

Check `tesseract --version`, `uv --version`, and `python --version`; run `uv sync` from the repository root; and confirm the OCR settings in `backend/.env`. Use Manual Entry or Excel import if scanning is not available.

### A SQL prompt shows `->`

The SQL statement is incomplete. Enter `\c` to cancel it, then `EXIT;` to leave the SQL prompt. Shell commands such as `mysql ... < database/schema.sql` must be run in the operating-system terminal, not inside `mysql>`.

## Testing

From the repository root:

```bash
cd backend
npm test
```

The test suite uses a stub database for application smoke/security checks and unit tests. It does not prove that a live deployment is configured securely; perform deployment checks and a database backup/restore test separately.

## License and security

This is proprietary school software. Public visibility of this repository does not grant permission to reuse, modify, deploy, redistribute, or sell it. Read the full [LICENSE](LICENSE).

For security expectations, safe deployment configuration, and how to privately report a suspected vulnerability, read [SECURITY.md](SECURITY.md). For practical day-to-day instructions for each account role, read the [Portal User Guide](PORTAL_GUIDE.md).
