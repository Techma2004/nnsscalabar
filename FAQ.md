# Frequently asked questions

Find your problem, copy the **exact** error text if you need to search. Guides: [INSTALL.md](INSTALL.md) (PC) · [SERVER.md](SERVER.md) (own server) · [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md) (online) · [OPERATIONS.md](OPERATIONS.md) · [CONFIGURATION.md](CONFIGURATION.md) · [PORTAL_GUIDE.md](PORTAL_GUIDE.md).

## Contents

- [Windows: programs not found](#windows-programs-not-found)
- [Database](#database)
- [Starting the server](#starting-the-server)
- [Signing in](#signing-in)
- [Online (Vercel, Supabase, domain)](#online-vercel-supabase-domain)
- [Scanner (OCR)](#scanner-ocr)
- [Everyday running](#everyday-running)
- [Security](#security)
- [Using the portal](#using-the-portal)

---

## Windows: programs not found

### `node`, `npm`, `git`, `psql` or `uv` "is not recognized"

1. **Open a new PowerShell window.** A window only sees programs installed before it opened. This fixes most cases.
2. If it still fails, the program's folder is not on PATH. Git, Node.js and uv add themselves; **PostgreSQL and Tesseract do not**. Use their full path, for example `& "C:\Program Files\PostgreSQL\16\bin\psql.exe" --version`, or add the folder to PATH (Start -> "Edit the system environment variables" -> *Environment Variables* -> `Path` -> *Edit* -> *New*), then open a new window.
3. Refresh a window without closing it:
   ```powershell
   $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
   ```

### `npm.ps1 cannot be loaded because running scripts is disabled on this system`

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Answer `Y`, open a new window. Or type `npm.cmd` instead of `npm`.

### The `<` symbol gives an error in PowerShell

PowerShell does not support `psql ... < file.sql`. Use `-f` instead, as this documentation does: `psql ... -f database/postgres/schema.sql`.

### My `.env` changes are ignored on Windows

- The file must be called exactly `.env`, not `.env.txt` (File Explorer -> View -> *File name extensions* to check).
- It must be in the `backend` folder, and you must **stop and start** the portal after editing.

### `python3` is not recognized

Not needed. The scanner uses `uv`. See [Scanner](#scanner-ocr).

---

## Database

### `password authentication failed for user "nnss_user"`

The password in `DATABASE_URL` is not the one set with `CREATE USER`, or it has a symbol that must be encoded in a URL (space `%20`, `#` `%23`, `@` `%40`, `/` `%2F`, `?` `%3F`, `:` `%3A`, `%` `%25`, `!` `%21`). Easiest fix: set a simple letters-and-numbers password.

```sql
ALTER USER nnss_user WITH PASSWORD 'Nnss4Calabar2026Db';
```

(run inside a `postgres` session: [INSTALL.md section 5.1](INSTALL.md#51-open-a-database-administrator-session)), then update `DATABASE_URL` and restart.

### `connect ECONNREFUSED 127.0.0.1:5432`

PostgreSQL is not running. Linux: `sudo systemctl start postgresql`. macOS: `brew services start postgresql@16`. Windows: start the `postgresql-x64-16` service (`Get-Service postgresql*`).

### `database "nnss_calabar" does not exist`

Create it: `CREATE DATABASE nnss_calabar OWNER nnss_user;` ([INSTALL.md section 5.2](INSTALL.md#52-create-the-user-and-database)).

### `relation "users" does not exist` (or another table)

The schema has not been loaded into this database. Run `psql -h 127.0.0.1 -U nnss_user -d nnss_calabar -f database/postgres/schema.sql` from the project folder. Online, paste the file into the Supabase SQL Editor.

### `permission denied to create extension "citext"`

The database was not created with `OWNER nnss_user`. Either recreate it that way or run the schema once as the `postgres` user.

### `Tenant or user not found` (Supabase)

The username part of the connection string is wrong. Copy it again from Supabase: it is `postgres.<project-ref>`, not just `postgres`.

### Can I run `schema.sql` more than once?

Yes. It only adds what is missing and prints "already exists, skipping" notices. It does not change existing tables or delete data.

### Which database should I use?

PostgreSQL only (local, or Supabase). The old MySQL/MariaDB version is gone; its files are in `database/legacy-mysql/` for history and must not be used.

### The `postgres=#` prompt shows `postgres-#` and nothing happens

A SQL command is missing its `;` at the end. Type `;` and press Enter. To leave: `\q`.

---

## Starting the server

### The server exits and mentions `JWT_SECRET` or a placeholder password

`backend/.env` still has the example text. Set a real database password in `DATABASE_URL` and a random secret of 32+ characters:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### `Database connection: failed: ...`

The server runs but cannot reach the database. The text after "failed:" is the reason: look it up in [Database](#database).

### `TRUST_PROXY_HOPS must be an integer from 0 to 10`

The setting has a wrong value (for example text). Use a whole number, or delete the line. (A blank value is treated as not set.)

### `EADDRINUSE: address already in use :::5000`

Another copy is running, or another program uses port 5000. Close the other window, or set `PORT=5001`. To find it: Windows `netstat -ano | findstr :5000`; Linux/macOS `lsof -i :5000`.

### `[dotenv] injected env (N) from .env` / `◇ injected env`

A normal information line, not an error.

### `Cannot find module ...`

Run `npm install` inside the `backend` folder, then start again.

### Which folder do I run commands in?

| Command | Folder |
|---|---|
| `npm install`, `npm start`, `npm run seed:admin`, `npm run seed:commandant` | `backend` |
| `psql ... -f database/postgres/schema.sql`, `node database/import-rosters.js` | project root |
| `uv sync` (scanner) | project root |

---

## Signing in

### I sign in but the portal sends me back to the login page

The browser is throwing the login cookie away: the cookie is marked HTTPS-only (`COOKIE_SECURE=true`, or `NODE_ENV=production`) but you opened the portal over plain `http://`.

- **Testing on your own PC or LAN with made-up data:** set `COOKIE_SECURE=false` in `backend/.env` and restart.
- **Real school data:** do not weaken it. Use HTTPS ([SERVER.md](SERVER.md), [HTTPS.md](HTTPS.md)) or the online setup.

### "Request not allowed."

The address you typed is not on the portal's allow-list. Set `FRONTEND_ORIGIN` to the exact address, with `https://` and no slash at the end (several addresses separated by commas), and restart or redeploy. Plain `localhost` and the machine's own network addresses are allowed automatically.

### I forgot the admin or Commandant password

Put the new password in `INITIAL_ADMIN_PASSWORD` (or `INITIAL_COMMANDANT_PASSWORD`) in `backend/.env`, then from `backend` run `npm run seed:admin` (or `npm run seed:commandant`). It resets the password, switches the account on and signs out its other sessions. Remove the password from `.env` afterwards.

### Someone else forgot their password

An Administrator or the Commandant opens **Account Management**, finds the person and sets a new password.

### "Too many sign-in attempts"

10 attempts per account and address in 15 minutes. **Every attempt counts, including successful ones.** Wait and try again.

### Everyone gets "too many requests" at the same time

The portal is behind a proxy it does not know about, so every visitor looks like one address. Set `TRUST_PROXY_HOPS` to the number of proxies in front (normally `1`) and restart. With no proxy, keep `0`.

### My session ended by itself

Sessions last 8 hours. Changing a password or resetting an account also signs that person out everywhere.

### Another device cannot open the portal

1. Set `HOST=0.0.0.0` in `.env` and restart: the server prints addresses such as `http://192.168.1.20:5000`.
2. Use one of **those** addresses, not `localhost`, on the same network.
3. Allow the port in the firewall (private networks only). See [INSTALL.md section 8](INSTALL.md#8-let-other-computers-on-the-school-network-use-it).
4. If sign-in loops on that device, see the cookie question above.

---

## Online (Vercel, Supabase, domain)

The full table of problems we met and their fixes is in [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md#problems-we-hit-and-the-fixes). The most common:

- **`500 FUNCTION_INVOCATION_FAILED`**: open the deployment's **Logs** in Vercel; the first error line says why (a missing or blank environment variable, a wrong `DATABASE_URL`).
- **Blank variable crashes the app**: delete empty variables in Vercel instead of leaving them blank.
- **"Request not allowed."** on your domain: set `FRONTEND_ORIGIN` and redeploy.
- **Changed a variable and nothing happened**: Vercel reads variables only on a new deployment: click **Redeploy**.
- **Pictures cannot be uploaded**: the Cloudflare R2 variables are not set ([DEPLOY_VERCEL.md step 3](DEPLOY_VERCEL.md#3-cloudflare-r2-images--optional-until-you-need-news-pictures)).
- **The scanner is unavailable online**: expected; use the Excel template.
- **Pages load slowly**: see [DEPLOY_VERCEL.md "Speed"](DEPLOY_VERCEL.md#speed).

---

## Scanner (OCR)

The scanner is optional and **PC / own server only**. Manual Entry and Excel import work without it.

### The scanner says it is unavailable

`AI_SCORE_IMPORT_ENABLED` is `false`, or Tesseract / `uv` is not installed. Install them ([INSTALL.md section 9](INSTALL.md#9-optional-the-score-sheet-scanner-ocr)), run `uv sync` once from the project root, set `AI_SCORE_IMPORT_ENABLED=true`, restart.

### The scanner says Tesseract is not installed

Windows: install the UB Mannheim build in its default folder (the portal checks the standard folders), or set `TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe` in `backend/.env`. Linux: `sudo apt install tesseract-ocr`. macOS: `brew install tesseract`. Restart.

### `uv` is not recognized, or the scanner cannot start

Install uv, open a **new** terminal, check `uv --version`, run `uv sync` from the project root, and **restart the portal from that new terminal**. Plain Python instead: `OCR_RUNNER=python` plus `OCR_PYTHON_BIN` pointing to a Python with the project's dependencies.

### The scan times out

Large or poor photos take longer. Raise `OCR_TIMEOUT_MS`, or retake the photo flat, bright and sharp.

### It read a wrong score or the wrong student

OCR can misread handwriting. Always check the preview and fix cells by hand before submitting.

### "Too many scans"

Each teacher can scan 6 sheets in 5 minutes. Wait a few minutes.

---

## Everyday running

### How do I start the portal each day? How do I make it start by itself?

See [OPERATIONS.md](OPERATIONS.md#start-stop-restart) and [start automatically](OPERATIONS.md#start-automatically-when-the-computer-starts).

### How do I back up and restore the database?

[OPERATIONS.md: backups and restore](OPERATIONS.md#backups-and-restore). Use `pg_dump -f` / `pg_restore`; do not use `>` in Windows PowerShell.

### How do I update to a newer version?

[OPERATIONS.md: update](OPERATIONS.md#update-to-a-newer-version).

### Where are all the settings explained?

[CONFIGURATION.md](CONFIGURATION.md).

---

## Security

- **Is it safe to leave `JWT_SECRET` as the example?** No. The server will not start with the placeholder. Use a long random value; never share or commit it, and note that changing it signs everyone out.
- **Should real student data go over plain HTTP?** No. Use HTTP only for tests with made-up data. See [SECURITY.md](SECURITY.md).
- **Should I commit `backend/.env`?** Never. Share `.env.example` instead.
- **Should I leave the admin password in `.env`?** No. After the first accounts exist, delete the `INITIAL_*_PASSWORD` lines.
- **I pasted a password or secret in a chat or screenshot.** Change it: reset the database password and update `DATABASE_URL`; generate a new `JWT_SECRET`; change portal passwords.

---

## Using the portal

### How do I set up the blog and newsletter account?

An Administrator or the Commandant creates the person in **Account Management** with the role **News team (blog & newsletter)**, entering a unique User ID, full name, phone number and an initial password. See [PORTAL_GUIDE.md chapter 7](PORTAL_GUIDE.md#7-news-team-interface-blog-and-newsletter).

### A student cannot see their result

Results appear only after the HOD approves them. Check the session and term, and that the sheet is approved, not pending or returned.

### I cannot see a class, subject or student

What you see depends on your role and assignments. Ask an Administrator to check your class, arm and subject assignments.

### Where is the full user guide?

[PORTAL_GUIDE.md](PORTAL_GUIDE.md) covers each role step by step.

### Still stuck?

Copy the **exact** error text and the command that caused it (remove passwords), and send it to the person who maintains the portal.
