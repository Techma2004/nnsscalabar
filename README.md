# NNSS Calabar School Management System

A web-based school management platform and public website for Nigerian Navy Secondary School, Calabar. It has role-based portals for the Commandant, administrators, Heads of Department, teachers, students and the school news team, with continuous-assessment score sheets, a result approval workflow, printable results, announcements and a public blog and newsletter.

> **Before real school use:** replace sample/demo records with verified school data, review account permissions, use HTTPS, and set up database backups. Do not use real student data over plain HTTP.

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/) [![Express](https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white)](https://expressjs.com/) [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14%2B-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/) [![Deploy](https://img.shields.io/badge/Deploy-Vercel%20%7C%20PC%20%7C%20Server-black)](#three-ways-to-run-it)

## Documentation

| I want to... | Read |
|---|---|
| Install it on a **school PC** (Linux, macOS, Windows) | [INSTALL.md](INSTALL.md) |
| Run it on **my own server** (Ubuntu or Windows Server, HTTPS, service) | [SERVER.md](SERVER.md) |
| Put it **online** with Vercel + Supabase + Cloudflare R2 + a domain | [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md) |
| Back up, restore, update, start on boot, reset a password | [OPERATIONS.md](OPERATIONS.md) |
| Look up a setting | [CONFIGURATION.md](CONFIGURATION.md) |
| Set up HTTPS (school CA or Let's Encrypt) | [HTTPS.md](HTTPS.md) |
| Fix an error | [FAQ.md](FAQ.md) |
| Learn to use the portal (each role) | [PORTAL_GUIDE.md](PORTAL_GUIDE.md) |
| Review security | [SECURITY.md](SECURITY.md) |
| Check the licence | [LICENSE](LICENSE) (proprietary, **not** open source) |

## Three ways to run it

It is the same program in all three. Only the settings differ (see the full table in [INSTALL.md](INSTALL.md#1-choose-how-to-run-it)).

| | **School PC** | **Own server** | **Online** |
|---|---|---|---|
| Guide | [INSTALL.md](INSTALL.md) | [SERVER.md](SERVER.md) | [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md) |
| Database | PostgreSQL on the PC | PostgreSQL on the server | Supabase (PostgreSQL) |
| Pictures | `frontend/uploads/` | `frontend/uploads/` | Cloudflare R2 |
| Score-sheet scanner (OCR) | optional | optional | not available |
| Stays running by itself | no | yes | yes |

Switching the database is one line: `DATABASE_URL` in `backend/.env` (local Postgres or the Supabase connection string).

## Features

- Responsive public website with news/blog, newsletter, light/dark theme and portal sign-in.
- Six account roles: `commandant`, `admin`, `hod`, `teacher`, `student` and `editor` (the news team, who write the blog and newsletter).
- HTTP-only JWT session cookie, bcrypt password hashing, database-backed login lockout, request rate limits, security headers, origin checks, and server-side role/assignment authorization.
- Student lifecycle (active, pending, withdrawn, graduated, repeating) with academic history kept; end-of-session promotion deactivates graduates' accounts.
- Curriculum, departments, subjects, class levels, arms, academic sessions and terms.
- Teacher class/arm/subject assignments.
- Score sheets: continuous assessment 30 (six components of 5) plus exam 70; totals, grades and remarks are generated (A/C/P/F for JSS, A1-F9 for SSS); HOD approval, return-for-correction, activity log.
- Excel score-sheet import/export, printable results and report cards, and an optional local OCR scanner (Tesseract) for photos and PDFs.
- Audience-aware announcements, dashboards, student change requests, health endpoint, graceful shutdown.

## Architecture

```text
Browser
  └── Node.js + Express  (serves frontend/ and the /api)
        ├── Authentication and role checks
        ├── Student / staff / results / assignments / announcements / dashboard routes
        ├── PostgreSQL        (local, or Supabase)
        └── Picture storage   (frontend/uploads/, or Cloudflare R2)
```

- One origin serves both the pages and the API; the frontend is plain HTML/JS with no build step.
- On Vercel the same Express app runs as one serverless function (`api/index.js`) and `frontend/` is served from the CDN.
- The database layer (`backend/db.js`) is the only place that talks to PostgreSQL; the schema is `database/postgres/schema.sql`.

## Requirements

- **Node.js 20 or newer** and npm
- **PostgreSQL 14 or newer** (or a Supabase project)
- Git, and a modern browser
- Optional, for the scanner: Python 3.11+, [uv](https://docs.astral.sh/uv/), Tesseract with English data

## Quick start (Linux / macOS)

Short version; the full guide with Windows and explanations is [INSTALL.md](INSTALL.md).

```bash
git clone https://github.com/Techma2004/nnsscalabar.git && cd nnsscalabar

# database (Linux: sudo -u postgres psql   |   macOS: psql postgres) then type:
#   CREATE USER nnss_user WITH PASSWORD 'Nnss4Calabar2026Db';
#   CREATE DATABASE nnss_calabar OWNER nnss_user;
psql -h 127.0.0.1 -U nnss_user -d nnss_calabar -f database/postgres/schema.sql

cd backend
npm install
cp .env.example .env        # set DATABASE_URL, JWT_SECRET, INITIAL_* passwords, COOKIE_SECURE=false
npm run seed:admin
npm run seed:commandant
npm start                   # open http://localhost:5000/login.html
```

## Repository layout

| Path | What it is |
|---|---|
| `frontend/` | The website and portal pages (HTML, CSS, JS) |
| `backend/` | Express server, routes, database adapter, seed scripts, tests |
| `database/postgres/schema.sql` | The complete database (run once on a new database) |
| `database/import-rosters.js` | Load class rosters from your own JSON file |
| `database/legacy-mysql/` | Old MySQL files, **kept for history only** |
| `api/index.js`, `vercel.json`, `package.json` | Vercel deployment (root `package.json` must match `backend/package.json`) |
| `deploy/nginx/` | nginx HTTPS reverse-proxy config for a Linux server |
| `ocr_score_sheet.py`, `pyproject.toml` | Optional scanner (not used on Vercel) |

## Testing

Run these against a **throwaway** database, never the school's live one. Start the server on it first.

```bash
# 1. The whole results journey through the real API: admin makes an HOD and a teacher,
#    the teacher fills a sheet, the HOD approves, the student signs in and sees the result.
BASE=http://127.0.0.1:5077 ADMIN_CODE=ADM001 ADMIN_PASSWORD=... node backend/test/e2e-portal.js

# 2. Browser checks (once: npm i --no-save playwright && npx playwright install chromium).
#    Every screen for every role; fails on JS errors, failed API calls or blank pages:
BASE=http://127.0.0.1:5077 ACCOUNTS='[{"role":"admin","code":"ADM001","pw":"..."},{"role":"student","code":"STU0001","pw":"..."}]' node backend/test/ui-sweep.js

# 3. The student "My Results" screen (session/term pickers, no-results message):
STUDENT_A=... STUDENT_B=... PASSWORD=... node backend/test/ui-results-picker.js
```

## Licence and security

This is proprietary school software. Public visibility of this repository does not grant permission to reuse, modify, deploy, redistribute or sell it: read the full [LICENSE](LICENSE). For security expectations, safe deployment and how to report a vulnerability privately, read [SECURITY.md](SECURITY.md).
