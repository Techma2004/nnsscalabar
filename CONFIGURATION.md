# Configuration reference

Everything you can change about the NNSS Calabar portal, in one place. Settings live in a file called **`.env`** inside the `backend` folder. If you have not created it yet, the install guides show how: [Windows](WINDOWS_SETUP.md#6-configure-the-application-the-env-file) · [Linux, macOS and the rest](README.md#configure-the-application).

Related: [Windows setup](WINDOWS_SETUP.md) · [FAQ](FAQ.md) · [Portal user guide](PORTAL_GUIDE.md) · [Security policy](SECURITY.md)

---

## Contents

- [How the `.env` file works](#how-the-env-file-works)
- [Quick start: the minimum you must set](#quick-start-the-minimum-you-must-set)
- [Server settings](#server-settings)
- [Database settings](#database-settings)
- [Security and login settings](#security-and-login-settings)
- [First-login (seed) settings](#first-login-seed-settings)
- [Score-sheet scanner settings](#score-sheet-scanner-settings)
- [Built-in limits (not configurable)](#built-in-limits-not-configurable)
- [Ready-made examples](#ready-made-examples)
- [Commands (`npm run ...`)](#commands-npm-run-)
- [Folders and files](#folders-and-files)
- [Database files in `database/`](#database-files-in-database)

---

## How the `.env` file works

- It is a plain text file with one `NAME=value` per line. Lines starting with `#` are comments.
- It must be named exactly **`.env`** (with the leading dot, and **no** `.txt` at the end) and sit in the **`backend`** folder, next to `server.js`.
- **No spaces** around the `=` sign: `PORT=5000`, not `PORT = 5000`.
- The portal reads the file **once, when it starts**. After you change it, **stop and start the portal** again.
- The file is read from the folder you start the portal in. Always run `npm start` **from inside `backend`**.
- Quote values that contain `#` or spaces, with **double quotes**: `DB_PASSWORD="pa#ss word"`. An unquoted `#` starts a comment and silently cuts the value off (`abc#def` is read as `abc`). This is the most common cause of a correct-looking password being rejected.
- Never share your `.env` or commit it to Git. It holds your database password and signing secret. (It is already ignored by Git.)
- The `◇ injected env (N) from .env` line you see when commands start is just information from the settings loader. It is not an error.

## Quick start: the minimum you must set

Copy `backend/.env.example` to `backend/.env`, then set at least:

| Setting | Why |
|---|---|
| [`DB_PASSWORD`](#db_password) | The password of the database user you created |
| [`JWT_SECRET`](#jwt_secret) | A long random secret; the server will not start without a good one |
| [`INITIAL_ADMIN_PASSWORD`](#first-login-seed-settings) | Password for your first portal login (used once by `npm run seed:admin`) |

Everything else has a safe default for running on one computer.

---

## Server settings

### `NODE_ENV`

| | |
|---|---|
| Default | `development` (in `.env.example`) |
| Values | `development` or `production` |

Set `production` when the portal is served over **HTTPS** to real users. It turns on the `Strict-Transport-Security` header and makes login cookies `secure` (HTTPS-only) unless you override that with [`COOKIE_SECURE`](#cookie_secure).

> If you set `production` but serve the portal over plain `http://`, browsers throw the login cookie away and **nobody can stay signed in**. See [the FAQ](FAQ.md#i-sign-in-but-the-portal-sends-me-back-to-the-login-page).

### `PORT`

| | |
|---|---|
| Default | `5000` |
| Example | `PORT=5001` |

The number after the colon in the portal's address (`http://localhost:5000`). Change it if something else already uses 5000 (the portal then stops with `EADDRINUSE`). Use a number between 1024 and 65535.

### `HOST`

| | |
|---|---|
| Default | `127.0.0.1` |
| Values | `127.0.0.1` (this computer only) or `0.0.0.0` (other computers on the network too) |

Leave it at `127.0.0.1` unless you deliberately want other devices to connect. With `0.0.0.0` the portal prints its network addresses when it starts. Before doing this, read the HTTPS warning in [SECURITY.md](SECURITY.md): plain HTTP exposes passwords and student records on the network.

### `FRONTEND_ORIGIN`

| | |
|---|---|
| Default | empty |
| Example | `FRONTEND_ORIGIN=https://portal.nnsscalabar.edu.ng` |

Extra web addresses that are allowed to talk to the portal, separated by commas. You **do not** need it for `localhost`, `127.0.0.1`, or the computer's own network addresses: those are allowed automatically. You **do** need it once the portal is reached through a real domain name or from a different host, for example behind a reverse proxy. Write the full address with `https://` and **no trailing slash**.

If a browser shows errors like *"Origin not allowed by CORS"* or requests are refused with 403 after you moved to a domain name, this is the setting to fix.

---

## Database settings

The portal needs a MySQL 8 or MariaDB 10.6+ database that already contains the schema (`database/schema.sql`) and a database user it can sign in as. The install guides create these.

### `DB_HOST`

| | |
|---|---|
| Default | `127.0.0.1` |

Where the database runs. Keep `127.0.0.1` when MySQL is on the same computer. Use `127.0.0.1` rather than `localhost`: on some systems `localhost` resolves to the IPv6 address first and fails.

### `DB_PORT`

| | |
|---|---|
| Default | `3306` |

The database's port. Change it only if your MySQL listens on another port (for example because XAMPP and MySQL are both installed).

### `DB_USER`

| | |
|---|---|
| Default | `nnss_user` |

The database account name the portal signs in as. It must match the account you created (`CREATE USER 'nnss_user'...`). Do not use `root` for the portal.

### `DB_PASSWORD`

| | |
|---|---|
| Default | `change-this-database-password` (a placeholder, **rejected at startup**) |

The password for `DB_USER`. The server refuses to start while this is still a placeholder. Wrap it in double quotes if it contains `#` or spaces.

### `DB_NAME`

| | |
|---|---|
| Default | `nnss_calabar` |

The name of the database. The schema file creates `nnss_calabar`; change this only if you deliberately renamed it. A one-letter spelling mistake here gives *Access denied to database* errors.

### `DB_POOL_SIZE`

| | |
|---|---|
| Default | `10` |

How many database connections the portal keeps open. Ten is plenty for a school. Raise it only if you see queries waiting under heavy use, and make sure MySQL's `max_connections` is higher.

---

## Security and login settings

### `JWT_SECRET`

| | |
|---|---|
| Default | empty, and **the server will not start** without a valid value |
| Rules | at least **32 characters**, unique, and not a placeholder such as `change-me` |

The key used to sign login sessions. Anyone who knows it can forge a login, so keep it private and never reuse it on another system. Generate one in a terminal (the same command works in PowerShell, Command Prompt, Linux and macOS):

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Paste the output after `JWT_SECRET=` with no spaces or quotes.

Changing the secret signs **everybody** out, which is useful if you suspect it leaked. Sessions last 8 hours.

### `COOKIE_SECURE`

| | |
|---|---|
| Default | empty (means: `true` when `NODE_ENV=production`, otherwise `false`) |
| Values | `true` or `false` |

Whether the login cookie is only sent over HTTPS. To put the portal behind TLS, see [HTTPS.md](HTTPS.md).

| Your situation | Setting |
|---|---|
| Served over HTTPS | leave empty, or `true` |
| Plain `http://` on one computer or an isolated test network, with **made-up data** | `false` |
| Plain `http://` with **real** student data | Don't. Set up HTTPS first. |

### `TRUST_PROXY_HOPS`

| | |
|---|---|
| Default | `0` |
| Values | a whole number from `0` to `10` |

How many reverse proxies (such as Nginx or Caddy) sit between the internet and the portal. The portal uses it to find each visitor's real address for its request limits.

- `0`: visitors connect directly. **Use this when there is no proxy.**
- `1`: one proxy in front (the usual case when you run Nginx on the same machine).
- Setting it **too low behind a proxy** makes every visitor look like the same address, so the request limits hit everyone at once ([FAQ](FAQ.md#everyone-gets-too-many-requests-at-the-same-time)).
  - **Example for a school.** Say the portal sits behind Caddy on the same server but `TRUST_PROXY_HOPS` is still `0`. The portal then sees every teacher, student and parent as `127.0.0.1`, so the whole school shares **one** bucket of 300 API requests per 15 minutes. That is about **20 requests per minute for everyone together**. A few teachers saving score sheets during the day can use it up, and then *everybody* sees "too many requests". With a proxy in front, set `TRUST_PROXY_HOPS=1`. This is the single most likely production misconfiguration.
- Setting it **higher than the real number** lets visitors fake their address. Count carefully.

---

## First-login (seed) settings

These are read **only** by the one-time commands `npm run seed:admin` and `npm run seed:commandant`, which create the first account so you can sign in. After that the portal itself manages accounts.

| Setting | Default in `.env.example` | Meaning |
|---|---|---|
| `INITIAL_ADMIN_CODE` | `ADM001` | Login ID of the first account |
| `INITIAL_ADMIN_PASSWORD` | `replace-with-a-strong-password` | Its password. **At least 8 characters.** |
| `INITIAL_ADMIN_NAME` | `NNSS System Administrator` | Display name |
| `INITIAL_ADMIN_EMAIL` | empty | Optional email |
| `INITIAL_ADMIN_ROLE` | `admin` | `admin` or `commandant`. Only a Commandant can create other administrators or Commandants through the portal, so most schools seed a **commandant** first. |
| `INITIAL_COMMANDANT_CODE` | `CMD001` | Used by `npm run seed:commandant` instead of the `ADMIN` settings |
| `INITIAL_COMMANDANT_PASSWORD` | `replace-with-a-strong-password` | At least 8 characters |
| `INITIAL_COMMANDANT_NAME` | `The Commandant` | Display name |
| `INITIAL_COMMANDANT_EMAIL` | empty | Optional email |

Good to know:

- Running a seed command **again with the same code resets that account's password** to the value in `.env` and signs it out everywhere. That is the supported way to recover a lost Commandant or administrator password.
- Once you have signed in and changed your password, you can blank the `INITIAL_*_PASSWORD` lines. The portal does not need them to run.

---

## Score-sheet scanner settings

The **AI Scanner** (teachers photograph a paper score sheet) is optional and runs entirely on your own computer; nothing is sent to the internet. It needs Tesseract OCR and either `uv` or Python. See [Windows setup, section 9](WINDOWS_SETUP.md#9-optional-the-ai-score-sheet-scanner) for the install steps.

### `AI_SCORE_IMPORT_ENABLED`

| | |
|---|---|
| Default | `true` |
| Values | `true` or `false` |

Set `false` to switch the scanner off completely. Teachers then use Score Sheet, Manual Entry or Excel import.

### `OCR_RUNNER`

| | |
|---|---|
| Default | `uv` |
| Values | `uv` or `python` |

How the scanner's Python program is started. `uv` (recommended) installs the scanner's libraries and a suitable Python automatically the first time. Use `python` only when `uv` cannot be installed; the Python you name in `OCR_PYTHON_BIN` must already have the libraries installed (`pip install pytesseract "Pillow>=13.0.0" opencv-python-headless numpy pypdfium2`).

### `OCR_PYTHON_BIN`

| | |
|---|---|
| Default | `python3` |
| Windows | **`python`** (or `py`); `python3` does not exist on most Windows PCs |

Only used when `OCR_RUNNER=python`: the command that starts Python.

### `OCR_TIMEOUT_MS`

| | |
|---|---|
| Default | `60000` (60 seconds) |

How long to wait for one scan before giving up, in **milliseconds** (1000 = one second). Multi-page PDFs and the very first scan (while `uv` downloads its libraries) take longer; raise it to `120000` if scans time out. Keep it at 60000 or more.

### `TESSERACT_CMD`

| | |
|---|---|
| Default | empty (look in `PATH`, then in the standard Windows install folders) |
| Example | `TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe` |

The full path to the Tesseract program. Needed only when Tesseract is installed somewhere unusual **and** is not on `PATH`. The Windows installer for Tesseract does not add it to `PATH`, but the standard folders (`C:\Program Files\Tesseract-OCR`, the `(x86)` equivalent, and `%LOCALAPPDATA%\Programs\Tesseract-OCR`) are checked automatically. Leave empty on Linux and macOS.

---

## Built-in limits (not configurable)

These protect the portal on modest hardware. They are fixed in the code. If a user hits one they see a polite "too many requests" message and must wait.

| Limit | Value |
|---|---|
| All API requests, per computer address | 300 per 15 minutes |
| Static pages and screen loads, per computer address | 1000 per 15 minutes |
| Sign-in attempts, per computer address **and** account | 10 per 15 minutes |
| Sign-in attempts, per computer address (all accounts together) | 300 per 15 minutes |
| Account lockout (kept in the database, survives a restart) | locked for 15 minutes after 10 wrong passwords in a row; a correct sign-in or an admin password reset clears it |
| Credential-stuffing alert | more than 20 failed sign-ins across at least 5 different accounts in 10 minutes writes a `SECURITY_ALERT` to the activity log; see `GET /api/admin/security-alerts` |
| Sign-in, sign-out and password requests | 120 per 15 minutes |
| Account details (`/api/auth/me`) | 300 per 15 minutes |
| Administration requests | 400 per 15 minutes |
| Directory, results and blog-management requests | 300 per 15 minutes |
| Dashboard, announcements and change requests | 200 per 15 minutes |
| Password changes, per user | 10 per 15 minutes |
| Scanner scans, per teacher | 6 per 5 minutes |
| Scanner readiness check | cached for 30 seconds |
| Login session length | 8 hours from last use |
| Excel score-sheet upload | about 4 MB file |
| Scanner photo or PDF | under 7 MB |
| Blog picture | PNG, JPEG or WebP, 2.5 MB |
| Passwords | at least 8 characters |

### How long the waiting period lasts

Every limit uses a **fixed window** that opens at your **first** request in it. Being blocked does **not** restart the clock. Example, for sign-in:

| Time | What happens |
|---|---|
| 08:00 | Attempt 1 — the window opens and will close at 08:15 |
| 08:02 | Attempt 10 — still allowed |
| 08:03 | Attempt 11 — blocked |
| 08:15 | The counter clears; 10 fresh attempts |

So the wait is **at most 15 minutes** (5 minutes for scans), and less if the window was already part-way through. Every "too many requests" response includes a **`Retry-After`** header giving the exact number of seconds to wait, so a front end can show a real countdown.

Note that a **successful** sign-in counts as an attempt too. Signing in and out repeatedly in a short time can trigger the limit even with the correct password.

**Scanner readiness check.** The scanner screen asks the server whether Tesseract and `uv` are available, and the server remembers the answer for 30 seconds (checking is slow, and every check starts the scanner program twice). The trade-off: right after you install `uv` or Tesseract, the scanner screen can still report "unavailable" for up to 30 seconds. Wait half a minute and reopen the screen; you do not need to restart the portal.

---

## Ready-made examples

Open `backend/.env` and use one of these as a starting point (replace every value in `< >`).

**1. One computer, trying it out (the default)**

```
NODE_ENV=development
PORT=5000
HOST=127.0.0.1
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=nnss_user
DB_PASSWORD="<your database password>"
DB_NAME=nnss_calabar
JWT_SECRET=<output of the node command above>
INITIAL_ADMIN_CODE=ADM001
INITIAL_ADMIN_PASSWORD="<first login password>"
```

**2. Several computers on the school network (test data only)**

Same as above, plus:

```
HOST=0.0.0.0
```

**3. Real school with HTTPS behind one Nginx or Caddy proxy**

```
NODE_ENV=production
PORT=5000
HOST=127.0.0.1
TRUST_PROXY_HOPS=1
FRONTEND_ORIGIN=https://portal.<your-school-domain>
```

(`COOKIE_SECURE` stays empty and becomes `true` automatically.)

**4. Windows with the scanner, Tesseract in an unusual folder**

```
AI_SCORE_IMPORT_ENABLED=true
OCR_RUNNER=uv
TESSERACT_CMD=D:\Tools\Tesseract-OCR\tesseract.exe
OCR_TIMEOUT_MS=120000
```

**5. No scanner at all**

```
AI_SCORE_IMPORT_ENABLED=false
```

---

## Commands (`npm run ...`)

Run these from the **`backend`** folder.

| Command | What it does |
|---|---|
| `npm install` | Downloads the packages the portal needs. Run once after downloading, and again after updating. |
| `npm start` | Starts the portal. |
| `npm run dev` | Starts the portal and restarts it automatically when code files change (for developers). |
| `npm run seed:admin` | Creates or resets the first account from the `INITIAL_ADMIN_*` settings. |
| `npm run seed:commandant` | Creates or resets the Commandant from the `INITIAL_COMMANDANT_*` settings. |
| `npm run build:template` | Rebuilds the blank Excel score-sheet template file (developers only). |

---

## Folders and files

| Path | What it is |
|---|---|
| `backend/` | The server: settings, routes, the database connection |
| `backend/.env` | **Your settings.** Private. Not in Git. |
| `backend/.env.example` | The template you copy to make `.env` |
| `frontend/` | The web pages, styles and scripts the browser downloads |
| `frontend/uploads/` | Pictures uploaded by the news team. Created on first upload. **Back it up with the database.** Not in Git. |
| `database/schema.sql` | The complete database for a fresh install |
| `database/00N_*.sql` | Upgrade steps for **older existing** databases (already included in `schema.sql`) |
| `ocr_score_sheet.py`, `pyproject.toml` | The scanner program and its library list |
| `score-sheet-template.xlsx` | The blank Excel score sheet |

## Database files in `database/`

| File | When to use it |
|---|---|
| `schema.sql` | **New installation:** run this one file. Safe to run again. Works on MySQL 8 and MariaDB. |
| `002_*` … `006_*.sql` | **Upgrading an old database only,** and only the ones you are missing, in number order. A new installation never needs them. |
| `import-rosters.js` | Optional: loads class lists from a roster JSON you pass with `--roster` (none is shipped) |

Always **back up before** changing a live database: see [Windows setup, section 11](WINDOWS_SETUP.md#11-backups-and-restore) or `mysqldump` on Linux and macOS.
