# Install guide

How to run the NNSS Calabar portal on a **school PC** (Linux, macOS or Windows). It is the same program everywhere: only the settings differ. To run it on your own server see [SERVER.md](SERVER.md); to put it online with Vercel see [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md).

## Contents

- [1. Choose how to run it](#1-choose-how-to-run-it)
- [2. Before you start (Windows users read this)](#2-before-you-start-windows-users-read-this)
- [3. Install the programs](#3-install-the-programs)
- [4. Get the project](#4-get-the-project)
- [5. Create the database](#5-create-the-database)
- [6. Configure `backend/.env`](#6-configure-backendenv)
- [7. Install packages, create the first login, start](#7-install-packages-create-the-first-login-start)
- [8. Let other computers on the school network use it](#8-let-other-computers-on-the-school-network-use-it)
- [9. Optional: the score-sheet scanner (OCR)](#9-optional-the-score-sheet-scanner-ocr)
- [10. Optional: load class rosters](#10-optional-load-class-rosters)
- [11. Troubleshooting](#11-troubleshooting)

---

## 1. Choose how to run it

| | **School PC** (this guide) | **Own server** ([SERVER.md](SERVER.md)) | **Online** ([DEPLOY_VERCEL.md](DEPLOY_VERCEL.md)) |
|---|---|---|---|
| Who can reach it | This PC, or the school network | Network or internet, with HTTPS | Anyone on the internet |
| Database | PostgreSQL on the same PC | PostgreSQL on the server | Supabase (PostgreSQL) |
| `DATABASE_URL` | `postgres://nnss_user:...@127.0.0.1:5432/nnss_calabar` | same | Supabase "transaction pooler" string, port `6543` |
| Pictures (news) | `frontend/uploads/` folder | `frontend/uploads/` folder | Cloudflare R2 |
| Score-sheet scanner (OCR) | Yes (optional) | Yes (optional) | No |
| Keeps running by itself | No: you start it (see [OPERATIONS.md](OPERATIONS.md)) | Yes: service / systemd | Yes: Vercel |
| HTTPS | Not needed on one PC; needed on a network | Required (nginx / Caddy) | Automatic |
| `COOKIE_SECURE` | `false` only for local tests with made-up data | `true` | `true` |
| `HOST` | `127.0.0.1` (one PC) or `0.0.0.0` (network) | `127.0.0.1` behind the proxy | not used |
| `TRUST_PROXY_HOPS` | `0` | `1` behind one proxy | leave unset (it is `1`) |

**The database is the only thing you choose with one line.** To move between a PC and Supabase, change `DATABASE_URL`. The code and the schema (`database/postgres/schema.sql`) are identical.

---

## 2. Before you start (Windows users read this)

Linux and macOS users can skip to [section 3](#3-install-the-programs).

Most Windows problems ("`node` is not recognized", "`psql` is not recognized") come from three things:

1. **Open a NEW PowerShell window after every install.** A window reads the list of program folders once, when it opens. If you installed something while it was open, it cannot see the new program. To refresh a window without closing it:
   ```powershell
   $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
   ```
2. **PATH is the list of folders Windows searches for programs.** Git, Node.js and uv add themselves. **PostgreSQL and Tesseract do not**, so this guide runs them by their full path.
3. **Type commands exactly, in the right folder.** Copy each command without the `PS C:\...>` in front. Lines starting with `#` are comments. Linux tips found on the internet (`export NAME=value`, `psql < file.sql`) do not work in PowerShell: this guide gives the PowerShell versions.

To open PowerShell: press the Windows key, type `PowerShell`, press Enter. A normal window is fine.

If `npm` shows a red error "running scripts is disabled on this system":

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

(or type `npm.cmd` instead of `npm`).

---

## 3. Install the programs

You need **Git**, **Node.js 20 or newer**, and **PostgreSQL 14 or newer**.

### Linux (Debian / Ubuntu)

```bash
sudo apt update
sudo apt install -y git curl postgresql postgresql-contrib
sudo systemctl enable --now postgresql

# Node.js 22 (the Ubuntu package is often too old)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Fedora: `sudo dnf install -y git nodejs postgresql-server postgresql-contrib`, then `sudo postgresql-setup --initdb` and `sudo systemctl enable --now postgresql`.

### macOS (Homebrew)

Install Homebrew from <https://brew.sh> first, then:

```bash
brew install git node postgresql@16
brew services start postgresql@16
echo 'export PATH="$(brew --prefix postgresql@16)/bin:$PATH"' >> ~/.zshrc
```

Close and reopen Terminal.

### Windows

In PowerShell:

```powershell
winget install -e --id Git.Git
winget install -e --id OpenJS.NodeJS.LTS
winget install -e --id PostgreSQL.PostgreSQL.16
```

(or download the installers from git-scm.com, nodejs.org and postgresql.org/download/windows). In the PostgreSQL installer:

- Keep the defaults and the port **5432**.
- It asks you to choose a password for the database superuser `postgres`. **Write it down.** You need it once, in section 5.
- Untick Stack Builder at the end.

**Close PowerShell and open a new one**, then check:

```powershell
git --version
node --version      # must show v20 or higher
npm --version
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" --version
```

If you installed a different PostgreSQL version, change `16` in that path (and in every command below that uses it).

### Check (Linux and macOS)

```bash
git --version
node --version      # v20 or higher
psql --version      # 14 or higher
```

---

## 4. Get the project

**Linux / macOS**

```bash
git clone https://github.com/Techma2004/nnsscalabar.git
cd nnsscalabar
```

**Windows (PowerShell)**

```powershell
cd C:\
git clone https://github.com/Techma2004/nnsscalabar.git nnss
cd C:\nnss
```

No Git? On the repository page click **Code -> Download ZIP**, unzip it, and open PowerShell in that folder. The rest of this guide calls that folder "the project folder".

---

## 5. Create the database

You create one database (`nnss_calabar`) and one user (`nnss_user`) that the portal uses. **Never run the portal as the `postgres` superuser.**

Choose a password for `nnss_user` now. **Use letters and numbers only** (for example `Nnss4Calabar2026Db`). Symbols such as `@ # / ? : %` and spaces must be encoded in `DATABASE_URL` later and are the most common cause of "password authentication failed".

### 5.1 Open a database administrator session

| System | Command |
|---|---|
| Linux | `sudo -u postgres psql` |
| macOS | `psql postgres` |
| Windows | `& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -h 127.0.0.1` (enter the `postgres` password from the installer) |

You see a prompt like `postgres=#`.

### 5.2 Create the user and database

Type these two lines (replace the password; keep the single quotes; end each with `;`):

```sql
CREATE USER nnss_user WITH PASSWORD 'Nnss4Calabar2026Db';
CREATE DATABASE nnss_calabar OWNER nnss_user;
```

You should see `CREATE ROLE` and `CREATE DATABASE`. Leave `psql` with `\q`.

### 5.3 Load the schema (once)

This creates all tables, views and the starting data (departments, subjects, classes, terms). Run it from the **project folder**:

**Linux / macOS**

```bash
psql -h 127.0.0.1 -U nnss_user -d nnss_calabar -f database/postgres/schema.sql
```

**Windows**

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -h 127.0.0.1 -U nnss_user -d nnss_calabar -f database/postgres/schema.sql
```

Enter the `nnss_user` password. It prints many `CREATE` lines. A few `NOTICE ... already exists, skipping` lines are normal if you run it twice: the file is safe to run again.

### 5.4 Check it loaded

```bash
psql -h 127.0.0.1 -U nnss_user -d nnss_calabar -c "SELECT count(*) AS subjects FROM subjects;"
```

(on Windows use the full `psql.exe` path as above). It should show `32`.

> You only ever use `database/postgres/schema.sql`. The older `database/legacy-mysql/` files are from the MySQL version and must **not** be used.

---

## 6. Configure `backend/.env`

All settings live in one file. Create it from the example.

**Linux / macOS**

```bash
cd backend
cp .env.example .env
```

**Windows**

```powershell
cd C:\nnss\backend
Copy-Item .env.example .env
notepad .env
```

(On Linux/macOS open it with `nano .env` or any editor.) On Windows, make sure the file is called exactly `.env` and not `.env.txt` (in Notepad choose *All files* when saving).

### 6.1 Change these values

```dotenv
NODE_ENV=development
PORT=5000
HOST=127.0.0.1
DATABASE_URL=postgres://nnss_user:Nnss4Calabar2026Db@127.0.0.1:5432/nnss_calabar
JWT_SECRET=<paste a generated secret, see 6.2>
COOKIE_SECURE=false
TRUST_PROXY_HOPS=0
AI_SCORE_IMPORT_ENABLED=false
```

- `COOKIE_SECURE=false` is for **testing on one PC with made-up data**. For real school data use HTTPS ([HTTPS.md](HTTPS.md), [SERVER.md](SERVER.md)) and `COOKIE_SECURE=true`.
- Leave `FRONTEND_ORIGIN` empty for a normal local install.
- Put the passwords for the first accounts in the `INITIAL_ADMIN_*` and `INITIAL_COMMANDANT_*` lines (section 7).
- The server refuses to start if `JWT_SECRET` is missing, shorter than 32 characters, or the database password is still the placeholder `change-this-database-password`.
- If the database password contains `#` or spaces, put the whole `DATABASE_URL` in double quotes **and** encode the symbols ([CONFIGURATION.md](CONFIGURATION.md#database_url)).
- Every setting is explained in [CONFIGURATION.md](CONFIGURATION.md).

### 6.2 Generate a JWT secret

Works the same on every system (needs Node.js):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Paste the output after `JWT_SECRET=`. Keep it private and never commit `.env` to Git.

**Linux / macOS shortcut** that writes it into `.env` for you:

```bash
S=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))") && (grep -q '^JWT_SECRET=' .env && sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=$S|" .env && rm -f .env.bak || echo "JWT_SECRET=$S" >> .env)
```

---

## 7. Install packages, create the first login, start

First set the passwords for the two management accounts in `backend/.env`:

```dotenv
INITIAL_ADMIN_CODE=ADM001
INITIAL_ADMIN_PASSWORD=choose-a-strong-password
INITIAL_COMMANDANT_CODE=CMD001
INITIAL_COMMANDANT_PASSWORD=choose-another-strong-password
```

Then, in the `backend` folder:

```bash
npm install
npm run seed:admin
npm run seed:commandant
npm start
```

(`npm start` stays running; leave that window open.) You should see:

```
Database connection: OK
```

Open <http://localhost:5000/login.html> and sign in with `ADM001` and the password you set. Then sign in as `CMD001`.

After the first sign-in: **change both passwords inside the portal and delete the `INITIAL_*_PASSWORD` lines from `.env`.**

| I want to... | Do this |
|---|---|
| Stop the portal | Click the window and press `Ctrl + C` |
| Start it again | `cd backend` then `npm start` |
| Restart after changing `.env` | Stop, then start (`.env` is read only at start) |
| Start it automatically at boot | [OPERATIONS.md](OPERATIONS.md#start-automatically-when-the-computer-starts) |
| Develop with auto-reload | `npm run dev` |

What each person does next (adding teachers, classes, students, sessions) is in [PORTAL_GUIDE.md](PORTAL_GUIDE.md).

---

## 8. Let other computers on the school network use it

By default only this PC can open the portal. To allow others on the same network:

1. In `backend/.env` set `HOST=0.0.0.0` and restart the portal. It then prints the network address, for example `http://192.168.1.20:5000`.
2. Allow the connection in the PC's firewall, **private networks only**:
   - **Windows:** accept the Defender Firewall prompt for `node.exe` (Private networks). If it never appeared: *Windows Security -> Firewall -> Allow an app*.
   - **Ubuntu:** `sudo ufw allow from 192.168.1.0/24 to any port 5000 proto tcp` (use your own network range).
   - **macOS:** accept the "allow incoming connections" prompt for `node`.
3. Other computers open the printed address plus `/login.html`, for example `http://192.168.1.20:5000/login.html`.

Over plain `http://` passwords and student records travel **unencrypted**. That is acceptable for testing with made-up data on a trusted network. For real data set up HTTPS ([HTTPS.md](HTTPS.md)) or use the online setup. Another computer logging in over plain HTTP also needs `COOKIE_SECURE=false`.

---

## 9. Optional: the score-sheet scanner (OCR)

The scanner reads a photo or PDF of a score sheet and fills in a draft that the teacher must check. It is optional: Score Sheet, Manual Entry and Excel import work without it. It runs **only on a PC or your own server**, not on Vercel.

You need **Tesseract** (with English data) and **uv** (the Python tool).

| System | Install |
|---|---|
| Linux | `sudo apt install -y tesseract-ocr` then `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| macOS | `brew install tesseract uv` |
| Windows | `winget install -e --id astral-sh.uv`, then download Tesseract from <https://github.com/UB-Mannheim/tesseract/wiki> and keep the default folder `C:\Program Files\Tesseract-OCR` (it does not add itself to PATH; the portal finds it there) |

Open a **new** terminal. Then, from the **project folder** (not `backend`):

```bash
uv sync
```

In `backend/.env`:

```dotenv
AI_SCORE_IMPORT_ENABLED=true
OCR_RUNNER=uv
OCR_TIMEOUT_MS=60000
# Windows, only if Tesseract is in another folder:
# TESSERACT_CMD=D:\Tools\Tesseract-OCR\tesseract.exe
```

Restart the portal and check the scanner status on the teacher's score-entry screen. Details and problems: [FAQ.md](FAQ.md#scanner-ocr).

---

## 10. Optional: load class rosters

To load students from your own roster file (the real names are personal data of children, so no roster is shipped with the project and `database/rosters/` is git-ignored). From the project folder:

```bash
node database/import-rosters.js --roster /path/to/your-roster.json          # dry run: shows what would change
node database/import-rosters.js --roster /path/to/your-roster.json --apply  # writes to the database
```

The file format is described at the top of `database/import-rosters.js`. The command prints the temporary student passwords into a git-ignored file: hand them out privately, then delete that file.

---

## 11. Troubleshooting

| Problem | Fix |
|---|---|
| `node`, `npm` or `git` "is not recognized" (Windows) | Open a **new** PowerShell ([section 2](#2-before-you-start-windows-users-read-this)) |
| `psql` "is not recognized" | Windows: use the full path `& "C:\Program Files\PostgreSQL\16\bin\psql.exe"`. macOS: re-run the `PATH` line in section 3 and reopen Terminal. Linux: `sudo apt install postgresql-client` |
| `password authentication failed for user "nnss_user"` | The password in `DATABASE_URL` differs from the one in `CREATE USER`, or it contains a symbol that must be encoded. Reset it: open a `postgres` session (5.1) and run `ALTER USER nnss_user WITH PASSWORD 'newpass';` |
| `connection refused` / `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL is not running. Linux: `sudo systemctl start postgresql`. macOS: `brew services start postgresql@16`. Windows: `Get-Service postgresql*` and start it |
| `database "nnss_calabar" does not exist` | Redo 5.2 |
| `relation "users" does not exist` | The schema is not loaded: redo 5.3 |
| `permission denied to create extension "citext"` | Create the database with `OWNER nnss_user` (5.2), or run the schema once as `postgres` |
| Server exits and mentions `JWT_SECRET` or a placeholder password | Set a real value in `backend/.env` (6.1) |
| `EADDRINUSE: address already in use :::5000` | The portal is already running (check other windows) or change `PORT` |
| Sign-in works but sends you back to the login page | Plain HTTP with `COOKIE_SECURE=true`. Set `COOKIE_SECURE=false` for local tests, or use HTTPS |
| Another device cannot open the portal | Section 8: `HOST=0.0.0.0`, firewall, same network |
| `Cannot find module ...` | Run `npm install` inside `backend` |

More answers: [FAQ.md](FAQ.md).
