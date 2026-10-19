# Frequently asked questions

Quick answers to the problems people hit most often. Each answer says what is wrong, why, and exactly what to do.

Related: [Windows setup](WINDOWS_SETUP.md) · [Configuration reference](CONFIGURATION.md) · [README](README.md) · [Portal user guide](PORTAL_GUIDE.md) · [Security policy](SECURITY.md)

**How to read the commands:** commands shown in code blocks are typed into a terminal (PowerShell on Windows), never inside the `mysql>` prompt unless the block says so. Replace anything in `<angle brackets>` with your own value.

## Contents

- [Windows: tools not found](#windows-tools-not-found)
- [Database](#database)
- [Starting the server](#starting-the-server)
- [Signing in](#signing-in)
- [Scanner (OCR)](#scanner-ocr)
- [Everyday running](#everyday-running)
- [Security](#security)
- [Using the portal](#using-the-portal)

---

## Windows: tools not found

### `node`, `npm`, `git`, `mysql` or `uv` "is not recognized"

PowerShell looks for programs in a list of folders called **PATH**, and it reads that list **once, when the window opens**. So:

1. **Close every PowerShell window and open a new one.** This fixes most cases right after an install.
2. Still failing? Find out which program is the problem:

   ```powershell
   foreach ($c in 'git','node','npm','mysql','uv','tesseract') { if (Get-Command $c -ErrorAction SilentlyContinue) { "$c  found" } else { "$c  MISSING" } }
   ```
3. For each one that is MISSING, see the table below.

| Program | Added to PATH by its installer? | What to do |
|---|---|---|
| Git, Node.js, uv | Yes | Open a new window. If still missing, reinstall and keep the "add to PATH" option ticked. |
| MySQL Server | **No** | Add `C:\Program Files\MySQL\MySQL Server 8.0\bin` (adjust the version number) to PATH, or run `mysql.exe` by its full path. |
| Tesseract | **No** | Set `TESSERACT_CMD` in `backend\.env` (see [below](#the-scanner-says-tesseract-is-not-installed)). |

Step-by-step with screenshots-in-words: [WINDOWS_SETUP.md](WINDOWS_SETUP.md), including the appendix on adding a folder to PATH.

### `npm : File ...npm.ps1 cannot be loaded because running scripts is disabled on this system`

Windows blocks PowerShell scripts by default. Either allow them for your own account (one time):

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Answer `Y`, then open a new window. Or use `npm.cmd` instead of `npm` (for example `npm.cmd install`).

### I installed Node/Git/uv but a new window still cannot see it

Sign out of Windows and back in (or restart), then try again. If it still fails, the installer did not finish: re-run it as administrator and tick the PATH option.

### `python3` is not recognized

Windows has no `python3`. Use `python`, or let `uv` manage Python for you (`uv run ...` downloads a suitable Python by itself).

### The `<` symbol gives an error in PowerShell

PowerShell does not support `mysql ... < file.sql`. Use this instead, from the project folder:

```powershell
mysql -u root -p -e "SOURCE database/schema.sql"
```

Use forward slashes and do **not** put quotes around the path inside `SOURCE`.

### My `.env` changes are ignored on Windows

Check, in this order:

1. The file is named exactly `.env`, not `.env.txt`. Notepad likes to add `.txt`. In File Explorer, turn on **View → Show → File name extensions** and rename it.
2. It is inside the `backend` folder (`backend\.env`).
3. You started the server from the `backend` folder (`cd backend` then `npm start`). The settings file is read from the folder you start in.
4. You restarted the server after editing.

---

## Database

### ERROR 1045 (28000): Access denied for user

The username or password is wrong, or the user has no rights. Check:

- `DB_USER` and `DB_PASSWORD` in `backend\.env` match the account you created.
- **A password containing `#` must be in double quotes** in `.env`, otherwise everything after `#` is silently dropped:

  ```
  DB_PASSWORD="my#secret pass"
  ```
- No spaces around `=` and no stray quote characters (`DB_PASSWORD=abc`, not `DB_PASSWORD = abc`).
- You created the user on the same MySQL that the app connects to (`DB_HOST`, `DB_PORT`).

Test the login by hand: `mysql -u nnss_user -p nnss_calabar` and type the password. If that works but the app fails, the problem is in `.env`.

### ERROR 1044: Access denied for user ... to database

The user exists but has no rights on that database name, usually because of a typo in the database name (for example `nnss_calabr` instead of `nnss_calabar`). Grant it again, with the correct name:

```sql
GRANT ALL PRIVILEGES ON nnss_calabar.* TO 'nnss_user'@'localhost';
FLUSH PRIVILEGES;
```

### ERROR 2003: Can't connect to MySQL server

MySQL is not running or is on another port. On Windows: press **Win + R**, type `services.msc`, find **MySQL80** (or similar), and click **Start**. Then check `DB_HOST` and `DB_PORT` in `.env`.

### ERROR 1049: Unknown database

The database has not been created yet, or the name differs. Load the schema (it creates the database):

```powershell
mysql -u root -p -e "SOURCE database/schema.sql"
```

### ERROR 1064: You have an error in your SQL syntax (when loading schema.sql)

You are probably loading an **old copy** of the schema. Update the project (`git pull`) and try again. The current `database/schema.sql` loads on both **MySQL 8** and **MariaDB 10.6+**. If it still fails, copy the full error and the line number it mentions.

### Can I load `schema.sql` more than once?

Yes, it is safe to re-run on an empty or freshly created database and it does not fail on repeats. But **back up first** before running it against a database that already holds school data. For upgrades on a live database, follow the numbered migration files instead (see [README](README.md#existing-database-and-roster-tools)).

### Which database should I use: MySQL or MariaDB?

Either. MySQL 8+ is what the Windows guide uses. MariaDB 10.6+ also works.

### The `mysql>` prompt shows `->` and nothing happens

The statement is unfinished (missing `;`). Type `\c` and press Enter to cancel, or finish it with `;`. Type `EXIT;` to leave.

---

## Starting the server

### The server exits and mentions `JWT_SECRET` or `DB_PASSWORD`

The settings still contain the placeholder text from `.env.example`. The app refuses to start with placeholders on purpose. Put in a real database password and a long random secret:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Copy the output into `JWT_SECRET=` in `backend\.env`.

### `Database connection: failed: ...`

The server is running but cannot reach MySQL. The text after "failed:" is the real reason. Look it up in the [Database](#database) section above (1045, 1044, 2003, 1049).

### `EADDRINUSE: address already in use :::5000`

Something is already using that port, usually a second copy of the server you forgot about. Close the other window, or pick another port by setting `PORT=5001` in `.env`. To find what is using it on Windows:

```powershell
netstat -ano | findstr :5000
```

### `[dotenv] injected env (N) from .env`

That is a normal information line, not an error. It means the settings file was found and `N` values were loaded.

### `Cannot find module ...`

Dependencies are not installed. From the `backend` folder run `npm install`, then start again.

### Which folder do I run commands in?

| Command | Folder |
|---|---|
| `npm install`, `npm start`, `npm run seed:admin`, `npm test` | `backend` |
| `mysql ... SOURCE database/schema.sql` | project root (the folder that contains `database`) |
| `uv sync`, `uv run` (scanner) | project root |

---

## Signing in

### I sign in but the portal sends me back to the login page

The login cookie is being thrown away by the browser. It happens when `NODE_ENV=production` (which makes the cookie "secure") but you open the portal over plain `http://`. Browsers refuse to keep secure cookies over HTTP.

Fix, depending on your situation:

- **Testing on your own PC or LAN with made-up data:** add `COOKIE_SECURE=false` to `backend\.env` and restart the server.
- **Real school data:** do not weaken it. Serve the portal over **HTTPS** (a reverse proxy such as Nginx, Caddy or IIS in front) and keep the default.
- Or set `NODE_ENV=development` while testing.

### I forgot the admin or Commandant password

Re-running the seed command resets the password of that account. Set the values in `backend\.env`, then from the `backend` folder:

```powershell
npm run seed:admin
```

(or `npm run seed:commandant` with the `INITIAL_COMMANDANT_*` settings). It prints `Updated admin account ...`, turns the account on, and signs out its other sessions. Remove the password from `.env` afterwards.

### A teacher, HOD, student or news-team member forgot their password

An Administrator or the Commandant opens **Account Management**, finds the person, and sets a new password. Tell them to change it after signing in.

### "Too many sign-in attempts"

The portal limits sign-in attempts to protect accounts. Wait about 15 minutes and try again. If this happens to many people at once, see the next question.

### Everyone gets "too many requests" at the same time

The portal limits requests per address. If the server sits behind a reverse proxy and does not know it, **every visitor looks like the same address** and they all share one allowance.

Fix: set `TRUST_PROXY_HOPS` in `.env` to the number of proxies in front of the server (usually `1`) and restart. Do not set it if there is no proxy. See [CONFIGURATION.md](CONFIGURATION.md).

### My session ended by itself

Sessions last 8 hours. Signing in again is normal. Changing a password or having an account reset also signs that person out everywhere.

### Another device cannot open the portal

1. Set `HOST=0.0.0.0` in `.env` and restart. The server then prints the addresses it can be reached on, such as `http://192.168.1.20:5000`.
2. Use one of **those printed addresses** on the other device, not `localhost`.
3. Both devices must be on the same network.
4. Allow the port through the Windows firewall when Windows asks (choose **Private networks**).
5. If sign-in loops on the other device, see [the cookie question above](#i-sign-in-but-the-portal-sends-me-back-to-the-login-page).

If you open the portal from a different address or hostname, add it to `FRONTEND_ORIGIN` in `.env`.

---

## Scanner (OCR)

The scanner is optional. Manual Entry and Excel upload work without any of this.

### The scanner says Tesseract is not installed

Install Tesseract (Windows: the UB Mannheim build), then tell the portal where it is if the installer did not add it to PATH. In `backend\.env`:

```
TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
```

Restart the server. The standard install folders are also checked automatically.

### `uv` is not recognized, or the scanner cannot start

Install uv (see [WINDOWS_SETUP.md](WINDOWS_SETUP.md)), open a **new** PowerShell window, check `uv --version`, then run `uv sync` once from the project root. If you would rather use plain Python, set `OCR_RUNNER=python` and `OCR_PYTHON_BIN=python`, and install the packages from `pyproject.toml`.

### The scan times out

Large or poor-quality photos take longer. Raise `OCR_TIMEOUT_MS` in `.env`, or retake the photo flat, bright and sharp. The first run after `uv sync` is also slower.

### The scan read a wrong score or the wrong student

OCR can misread handwriting. Always check the preview before submitting, and fix any cell by hand. Pen ink works best on the supplied score-sheet template, photographed straight on in good light.

### "Too many scans"

Each teacher can scan 6 sheets in 5 minutes. Wait a few minutes.

---

## Everyday running

### How do I start the portal each day?

Open PowerShell, then:

```powershell
cd path\to\nnsscalabar\backend
npm start
```

Leave that window open while people use the portal. Closing it stops the portal. Press `Ctrl + C` to stop it cleanly.

### How do I back up the database?

```powershell
mysqldump -u root -p --result-file=backup.sql nnss_calabar
```

Use `--result-file=` rather than `>`. Windows PowerShell 5.1's `>` saves the file in a format MySQL cannot read back. Keep copies on another drive, and test a restore occasionally.

### How do I restore a backup?

```powershell
mysql -u root -p -e "SOURCE backup.sql"
```

Run it from the folder containing `backup.sql`.

### How do I update to a newer version?

1. Back up the database.
2. Stop the server (`Ctrl + C`).
3. In the project folder: `git pull`.
4. In `backend`: `npm install`.
5. Read the release notes for any new migration file in `database/` and apply it only if you are upgrading an existing database.
6. Start the server again.

### What does `schema.sql` contain, and do I need the other `.sql` files?

`schema.sql` is the complete database, including everything from files `002`–`006`. On a new install run only `schema.sql`. The other files only upgrade older databases that already hold data.

### Where are all the settings explained?

In [CONFIGURATION.md](CONFIGURATION.md): every `.env` setting, what it does, its default and example configurations.

---

## Security

### Is it safe to leave `JWT_SECRET` as the example?

No. The server will not start with the placeholder. Use a long random value and never share or commit it.

### Should real student data go over plain HTTP?

No. Use HTTP only for testing with made-up data. For real use put the portal behind HTTPS. See [SECURITY.md](SECURITY.md) and the README production checklist.

### Should I commit `backend/.env` to Git?

Never. It holds passwords. It is already ignored by Git. Share `.env.example` instead.

### Should I leave the admin password in `.env`?

After the first account exists, delete `INITIAL_ADMIN_PASSWORD` (and the commandant one) from `.env`.

---

## Using the portal

### How do I set up the blog and newsletter account?

An Administrator or the Commandant creates the person in **Account Management** with the role **News team (blog & newsletter)**, entering a unique User ID, full name, phone number and an initial password. That person signs in at `/login.html`, sees only **Blog & Newsletter** and their profile, and can write, publish, edit or hide posts. Details are in [the portal guide](PORTAL_GUIDE.md#blog-and-newsletter-news-team).

### A student cannot see their result

Results appear only after the HOD approves them. Check that the term and session are right and that the sheet is approved, not pending or returned.

### I cannot see a class, subject or student

What you see depends on your role and assignments. Ask an Administrator to check your class, arm and subject assignments.

### Where is the full user guide?

[PORTAL_GUIDE.md](PORTAL_GUIDE.md) covers each role step by step.

### Still stuck?

Copy the **exact** error text and the command that caused it (remove any passwords) and send it to the person who maintains the portal, or open an issue on the repository.
