# Windows setup guide

A complete, step-by-step guide to running the NNSS Calabar portal on a Windows PC. It assumes you have never used a command line before. If you get stuck, go to [section 13](#13-troubleshooting-windows) or the [FAQ](FAQ.md).

**Time needed:** about 45–60 minutes. **You need:** Windows 10 or 11 (64-bit), an administrator account on the PC, an internet connection for the downloads, and roughly 3 GB of free disk space.

Related guides: [Configuration reference](CONFIGURATION.md) · [FAQ](FAQ.md) · [Portal user guide](PORTAL_GUIDE.md) · [README](README.md)

---

## Contents

0. [Read this first (3 minutes)](#0-read-this-first-3-minutes)
1. [What you will install](#1-what-you-will-install)
2. [Check what you already have](#2-check-what-you-already-have)
3. [Install the programs](#3-install-the-programs)
4. [Download the project](#4-download-the-project)
5. [Create the database](#5-create-the-database)
6. [Configure the application (the `.env` file)](#6-configure-the-application-the-env-file)
7. [Install packages, create the first login, start the portal](#7-install-packages-create-the-first-login-start-the-portal)
8. [Day-to-day use: start, stop, restart](#8-day-to-day-use-start-stop-restart)
9. [Optional: the AI score-sheet scanner](#9-optional-the-ai-score-sheet-scanner)
10. [Optional: let other computers on the school network use it](#10-optional-let-other-computers-on-the-school-network-use-it)
11. [Backups and restore](#11-backups-and-restore)
12. [Updating to a newer version](#12-updating-to-a-newer-version)
13. [Troubleshooting (Windows)](#13-troubleshooting-windows)
- [Appendix A: add a folder to PATH](#appendix-a-add-a-folder-to-path)
- [Appendix B: find where a program is installed](#appendix-b-find-where-a-program-is-installed)
- [Appendix C: start completely over](#appendix-c-start-completely-over)

---

## 0. Read this first (3 minutes)

Most Windows problems people report ("`node` is not recognized", "`mysql` is not recognized", "`uv` is not recognized") come from the same three things. Understanding them now saves hours.

### Rule 1: open a NEW PowerShell window after every install

A PowerShell window reads the list of program locations **once, when it opens**. If you install Node.js, MySQL, uv or Tesseract while a window is already open, that window will never see the new program. **Close it and open a new one.**

If you cannot close the window, refresh it instead (paste this one line):

```powershell
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
```

### Rule 2: "PATH" is the list of folders Windows searches for programs

When you type `node`, Windows looks through the folders on the **PATH** list for `node.exe`. If a program's folder is not on that list, you get *"is not recognized as the name of a cmdlet, function, script file, or operable program"* even though the program **is installed**.

Some installers add themselves to PATH and some do not:

| Program | Adds itself to PATH? | Where it installs |
|---|---|---|
| Git | Yes | `C:\Program Files\Git\cmd` |
| Node.js | Yes | `C:\Program Files\nodejs` |
| uv | Yes (your user PATH), but only new windows see it | `%USERPROFILE%\.local\bin` |
| **MySQL Server** | **No** | `C:\Program Files\MySQL\MySQL Server 8.0\bin` (the folder name matches your version, for example `8.4`) |
| **Tesseract OCR** | **No** | usually `C:\Program Files\Tesseract-OCR` |

So for **MySQL** you must add the folder to PATH yourself (step 3.3). **Tesseract** is different: the portal finds it in its standard folder automatically, so you only need PATH for it if you want to run `tesseract` by hand (step 3.5).

### Rule 3: type commands exactly, and run them in the right folder

- Copy each command **without** the `PS C:\...>` prompt in front of it.
- Lines that start with `#` are comments for you. You can paste them; PowerShell ignores them.
- Many commands only work **inside the project folder**. The guide tells you when to `cd` (change folder).
- Linux and macOS instructions found on the internet often **do not work in PowerShell**. Two examples: `mysql ... < file.sql` and `export NAME=value`. This guide gives the Windows versions.

### How to open PowerShell

1. Press the **Windows key**, type `PowerShell`.
2. Click **Windows PowerShell** (or **Terminal**). A normal window is fine. Only open it **as Administrator** (right-click → *Run as administrator*) when a step says so.

You will know it worked when you see a line ending in `>`, such as `PS C:\Users\You>`.

---

## 1. What you will install

| Program | What it is for | Needed? |
|---|---|---|
| **Git** | Downloads the project and later updates | Recommended (you can use a ZIP download instead) |
| **Node.js 20 or newer (LTS)** | Runs the portal. Includes `npm`. | **Required** |
| **MySQL Server 8** (or MariaDB 10.6+) | The database that stores accounts and results | **Required** |
| **uv** | Runs the scanner's Python code. Downloads the Python it needs by itself. | Only for the AI Scanner |
| **Tesseract OCR** | Reads text from photos of score sheets | Only for the AI Scanner |

You do **not** need to install Python separately when you use uv. The score-entry screens (Score Sheet, Manual Entry, Excel import) work without uv and Tesseract; only the **AI Scanner** needs them. You can install them later.

---

## 2. Check what you already have

Open PowerShell and paste this. It tells you what is already installed and where:

```powershell
foreach ($t in "git","node","npm","mysql","uv","tesseract") {
  $c = Get-Command $t -ErrorAction SilentlyContinue
  if ($c) { "{0,-10} OK       {1}" -f $t, $c.Source } else { "{0,-10} MISSING" -f $t }
}
```

Anything marked **MISSING** is either not installed or installed but not on PATH. Use section 3 for each one. Run the check again at the end of section 3: **git, node, npm and mysql should all say OK** (uv and tesseract only if you want the scanner).

---

## 3. Install the programs

### 3.1 Git (recommended)

1. Download **Git for Windows** from <https://git-scm.com/download/win> and run the installer.
2. Click **Next** through the screens. The defaults are fine.
3. Close PowerShell, open a **new** one, and check:

```powershell
git --version
```

You should see something like `git version 2.x.x.windows.x`.

> Do not want Git? Skip it and use the ZIP download in [section 4](#4-download-the-project).

### 3.2 Node.js (required)

1. Download the **LTS** installer from <https://nodejs.org/>. The project needs **version 20 or newer**; the current LTS is fine.
2. Run it and keep the defaults. Leave **"Add to PATH"** ticked. You do not need the optional "tools for native modules" checkbox.

Or, in PowerShell:

```powershell
winget install -e --id OpenJS.NodeJS.LTS
```

3. Close PowerShell, open a **new** one, and check both commands:

```powershell
node --version
npm --version
```

`node --version` must show `v20` or higher. If `node` works but `npm` shows a **red error about "running scripts is disabled"**, see the box below.

<details>
<summary><strong>Error: <code>npm.ps1 cannot be loaded because running scripts is disabled on this system</code></strong></summary>

Windows blocks PowerShell scripts by default, and `npm` is one. Allow scripts **for your own user only** (no administrator needed):

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Type `Y` and press Enter if asked. Open a new PowerShell and try `npm --version` again.

Quick workaround without changing any setting: type `npm.cmd` instead of `npm` (for example `npm.cmd install`).
</details>

### 3.3 MySQL Server (required)

1. Download **MySQL Installer** from <https://dev.mysql.com/downloads/installer/>. Choose the larger **offline** package (`mysql-installer-community`). You can skip the account sign-up: click **"No thanks, just start my download"**.
2. Run it. For **Setup Type**, choose **Server only** and click **Next**, then **Execute** to install.
3. When the **Configuration** screens appear, use these answers:

| Screen | Choose |
|---|---|
| Type and Networking | **Development Computer**, Port **3306** (keep the default) |
| Authentication Method | **Use Strong Password Encryption** (the recommended option) |
| Accounts and Roles | Set a **root password** and **write it down**. You need it in section 5. |
| Windows Service | Keep **Configure MySQL Server as a Windows Service** ticked, **Start the MySQL Server at System Startup** ticked. Note the service name (normally `MySQL80`). |

4. Click **Next / Execute / Finish** until the installer closes.

**Now make `mysql` work in PowerShell.** The installer does **not** add MySQL to PATH. First find the folder (the version number in the folder name may differ on your PC):

```powershell
Get-ChildItem "C:\Program Files\MySQL" -Recurse -Filter mysql.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty DirectoryName
```

It prints a folder such as `C:\Program Files\MySQL\MySQL Server 8.0\bin`. Add **that folder** to your PATH with the commands in [Appendix A](#appendix-a-add-a-folder-to-path). Then close PowerShell, open a **new** one, and check:

```powershell
mysql --version
```

You should see `mysql  Ver 8.x.x for Win64 ...`.

Check that the database service is running:

```powershell
Get-Service *mysql*
```

The `Status` column must say **Running**. If it says **Stopped**, open PowerShell **as Administrator** and run `Start-Service MySQL80` (use the name shown in the `Name` column).

> **Using XAMPP or MariaDB instead?** The portal works with MariaDB 10.6 or newer. The programs live in a different folder (for XAMPP, `C:\xampp\mysql\bin`; add that folder to PATH the same way). Older XAMPP releases ship an older MariaDB; if the database import in section 5 fails with a syntax error, install MySQL as above. XAMPP's default `root` user has **no password**; wherever this guide says `-p`, leave it out and just press Enter if asked for a password.

### 3.4 uv (only for the AI Scanner)

Skip this until you want the scanner. In PowerShell:

```powershell
winget install --id=astral-sh.uv -e
```

If `winget` is not available, use uv's own installer instead:

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

**Close PowerShell and open a new one**, then check:

```powershell
uv --version
```

You should see `uv 0.x.x`. If it says *not recognized*, uv's folder is not on PATH: add `%USERPROFILE%\.local\bin` using [Appendix A](#appendix-a-add-a-folder-to-path) (type the full path, for example `C:\Users\YourName\.local\bin`).

> **Important:** the portal starts `uv` itself. It uses the PATH of the window you started the portal from. If you installed uv **after** starting the portal, stop the portal and start it again from a **new** PowerShell window.

### 3.5 Tesseract OCR (only for the AI Scanner)

1. Download the Windows installer from the project's wiki: <https://github.com/UB-Mannheim/tesseract/wiki>.
2. Run it. **Keep the suggested install folder** (normally `C:\Program Files\Tesseract-OCR`). Make sure **English** language data is ticked (it is by default).
3. This installer does **not** add Tesseract to PATH. **You do not need to**: the portal looks in the standard install folders by itself.

To confirm, run it by its full path (adjust the folder if you installed elsewhere):

```powershell
& "C:\Program Files\Tesseract-OCR\tesseract.exe" --version
```

If you installed Tesseract in a **different folder**, tell the portal where it is by adding one line to `backend\.env` (see section 6):

```
TESSERACT_CMD=D:\Tools\Tesseract-OCR\tesseract.exe
```

Optional: to also type just `tesseract` in PowerShell, add `C:\Program Files\Tesseract-OCR` to PATH with [Appendix A](#appendix-a-add-a-folder-to-path).

### Run the check again

Close PowerShell, open a new one, and paste the check from [section 2](#2-check-what-you-already-have) again. `git`, `node`, `npm`, and `mysql` must say **OK** before you continue.

---

## 4. Download the project

Pick a folder **without spaces and without OneDrive sync**, for example `C:\nnss`. (Spaces mostly work, but a simple path avoids many problems.)

**With Git:**

```powershell
cd C:\
git clone https://github.com/Techma2004/nnsscalabar.git nnss
cd C:\nnss
```

**Without Git (ZIP):** open <https://github.com/Techma2004/nnsscalabar>, click **Code → Download ZIP**, then right-click the ZIP → **Extract All** into `C:\nnss`. Make sure the folder directly inside contains `backend`, `database`, and `frontend`; if there is one extra folder level, move into it:

```powershell
cd C:\nnss
dir
```

You must see `backend`, `database`, `frontend` listed. **Every command from here on is run from this project folder** unless the guide says otherwise.

---

## 5. Create the database

> **Why this section looks different from Linux guides:** Linux guides load the database with `mysql ... < schema.sql`. **PowerShell does not support the `<` symbol** (it says *"The '<' operator is reserved for future use"*). Use the commands below instead.

### 5.1 Load the schema

From the project folder (`C:\nnss`):

```powershell
mysql -u root -p -e "SOURCE database/schema.sql"
```

Enter the root password you set in step 3.3. Nothing is printed when it succeeds; you just get your prompt back.

Rules for this command:
- Run it **from the project folder**, so `database/schema.sql` is found.
- Use **forward slashes** (`database/schema.sql`) as shown.
- **Do not put quotes around the file path** inside `SOURCE`. Quoting it makes it fail.

It creates the database `nnss_calabar` with all tables, classes, arms, subjects, terms, and the starting blog posts. It is safe to run again; it will not duplicate anything.

<details>
<summary>Other ways to load it (if the command above fails)</summary>

**Command Prompt style redirect**, which Windows does support when run through `cmd`:

```powershell
cmd /c "mysql -u root -p < database\schema.sql"
```

**MySQL Workbench:** *File → Open SQL Script…* → choose `database\schema.sql` → click the lightning-bolt **Execute** button.
</details>

### 5.2 Check it loaded

```powershell
mysql -u root -p -e "SELECT COUNT(*) AS names FROM information_schema.tables WHERE table_schema='nnss_calabar';"
```

You should see **26** (21 tables and 5 views).

### 5.3 Create the database user the app will use

The portal should not use `root`. Create a limited user. **Choose your own password** and keep it; you will need it in section 6. Avoid putting `'` (a single quote) in it.

```powershell
mysql -u root -p
```

Enter the root password. Your prompt changes to `mysql>`. Now paste these lines (change `your-strong-db-password`), pressing Enter after each:

```sql
CREATE USER 'nnss_user'@'localhost' IDENTIFIED BY 'your-strong-db-password';
CREATE USER 'nnss_user'@'127.0.0.1' IDENTIFIED BY 'your-strong-db-password';
GRANT ALL PRIVILEGES ON nnss_calabar.* TO 'nnss_user'@'localhost';
GRANT ALL PRIVILEGES ON nnss_calabar.* TO 'nnss_user'@'127.0.0.1';
FLUSH PRIVILEGES;
EXIT;
```

Each line should answer `Query OK`. The two `CREATE USER` lines are needed because the app connects to `127.0.0.1`.

Prompt shows `->` instead of `mysql>`? A line is unfinished (usually a missing `;`). Type `\c` and press Enter to cancel, then retry the last line.

### 5.4 Test the new user

```powershell
mysql -u nnss_user -p -e "SELECT COUNT(*) AS posts FROM nnss_calabar.posts;"
```

Enter the **nnss_user** password. You should see `13`. If you get *Access denied*, see [troubleshooting](#13-troubleshooting-windows).

---

## 6. Configure the application (the `.env` file)

The portal reads its settings from a file named `.env` inside the `backend` folder. Every setting is explained in the [Configuration reference](CONFIGURATION.md).

### 6.1 Create the file

From the project folder:

```powershell
Copy-Item backend\.env.example backend\.env
notepad backend\.env
```

Notepad opens the file. If Notepad asks *"file not found, create a new file?"* you typed the path wrongly: click **No** and recheck.

### 6.2 Change these four values

| Line | Change it to |
|---|---|
| `DB_PASSWORD=` | the `nnss_user` password from step 5.3 |
| `JWT_SECRET=` | a long random secret: generate it below |
| `INITIAL_ADMIN_PASSWORD=` | the password for your first portal login (at least 8 characters) |
| `INITIAL_ADMIN_CODE=` | the login ID for the first account (for example `ADM001`) |

**Generate the `JWT_SECRET`.** In PowerShell (not in Notepad):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Copy the long text it prints and paste it after `JWT_SECRET=`.

Want the first account to be the **Commandant** rather than an Administrator? Also set `INITIAL_ADMIN_ROLE=commandant` (see [CONFIGURATION.md](CONFIGURATION.md#first-login-seed-settings)).

### 6.3 Rules that prevent the most common mistakes

- **Passwords containing `#` or spaces must be in double quotes:** `DB_PASSWORD="my#strong pass"`. An unquoted `#` cuts the password short without any warning and causes *Access denied*.
- **No spaces around `=`.** Write `PORT=5000`, not `PORT = 5000`.
- The server **refuses to start** if `JWT_SECRET` is shorter than 32 characters or is a placeholder, or if `DB_PASSWORD` is still `change-this-database-password`.
- Save with **File → Save** (keep the file name `.env`).

### 6.4 Make sure the file is really called `.env`

Notepad sometimes adds `.txt` and the file becomes `.env.txt`, which the portal ignores. Check:

```powershell
dir backend -Force | Select-String "env"
```

You must see `.env` and `.env.example`, and **not** `.env.txt`. If you see `.env.txt`, rename it:

```powershell
Rename-Item backend\.env.txt .env
```

---

## 7. Install packages, create the first login, start the portal

From the project folder:

```powershell
cd backend
npm install
```

This downloads the portal's packages (a few minutes the first time). Warnings in yellow are normal. Red `npm ERR!` lines are not; see [troubleshooting](#13-troubleshooting-windows).

Create the first login (the `INITIAL_ADMIN_*` values from your `.env`):

```powershell
npm run seed:admin
```

You should see `Created admin account ADM001.` (or `commandant`). A line mentioning `injected env` is just information, not an error.

Start the portal:

```powershell
npm start
```

You should see these two lines:

```
Database connection: OK
NNSS Calabar server listening on http://localhost:5000
```

`Database connection: OK` means the portal can reach MySQL with the details in your `.env`. If it says **`Database connection failed:`** followed by a message, the portal is running but cannot use the database; the message names the problem (see [troubleshooting](#13-troubleshooting-windows)). **Leave this window open**: closing it stops the portal.

Open your browser at **<http://localhost:5000/login.html>** and sign in with the `INITIAL_ADMIN_CODE` and `INITIAL_ADMIN_PASSWORD` you chose.

**Next steps after signing in:** change that password under **My Profile**, then follow the [portal user guide](PORTAL_GUIDE.md) to create the other accounts.

---

## 8. Day-to-day use: start, stop, restart

| I want to… | Do this |
|---|---|
| **Start** the portal | Open PowerShell, then `cd C:\nnss\backend`, then `npm start`. Keep the window open. |
| **Stop** the portal | Click the window and press **Ctrl + C** (answer `Y` if asked), or just close the window. |
| **Restart** after changing `.env` | Stop it, then start it again. Changes to `.env` are only read at start. |
| Check the database is running | `Get-Service *mysql*` → Status must be **Running**. |

The MySQL service starts automatically with Windows (you ticked that in step 3.3). The **portal does not**: someone must run `npm start` after each reboot. For a school server that must run unattended, ask your IT person to run it as a Windows service (for example with a service wrapper such as NSSM) and to put it behind HTTPS; see the production checklist in the [README](README.md#production-deployment-checklist).

---

## 9. Optional: the AI score-sheet scanner

The AI Scanner lets a teacher photograph a filled paper score sheet (blue or black pen is fine) and fills in the marks for review. It needs **uv** (3.4) and **Tesseract** (3.5). Everything else in the portal works without it.

### 9.1 Turn it on and test it

1. Install uv and Tesseract (sections 3.4 and 3.5). **Close PowerShell and open a new one.**
2. In `backend\.env` the defaults already work: `AI_SCORE_IMPORT_ENABLED=true` and `OCR_RUNNER=uv`. Leave them.
3. Check both tools are visible, from a **new** window:

```powershell
uv --version
& "C:\Program Files\Tesseract-OCR\tesseract.exe" --version
```

4. **Stop and restart the portal** (section 8) from that same new window.
5. Sign in as a teacher and open **AI Scanner**. The screen shows whether the scanner is ready.

**The first scan is slow** (up to a minute or two): uv downloads Python and the scanner's libraries once, and needs internet for that. Later scans are quick.

### 9.2 If the scanner says it is not available

| Message or symptom | Fix |
|---|---|
| *"uv not found"* | uv is not on the PATH of the window that started the portal. Install it, open a **new** PowerShell, start the portal from there. |
| *"Tesseract is not installed on this server (or is not on PATH)"* | Tesseract is in a non-standard folder. Add `TESSERACT_CMD=full\path\to\tesseract.exe` to `backend\.env` and restart. |
| Times out on the first scan | Raise `OCR_TIMEOUT_MS` (for example `120000`) in `.env`, restart, and try again once the downloads have finished. |
| *"Too many scans in a short time"* | Each teacher can run 6 scans per 5 minutes. Wait a few minutes. |

### 9.3 Alternative: plain Python instead of uv

Only if uv genuinely cannot be installed. Install Python 3.10+ from <https://www.python.org/downloads/> (tick **"Add python.exe to PATH"**), then:

```powershell
python -m pip install pytesseract Pillow opencv-python-headless numpy pypdfium2
```

and set in `backend\.env`:

```
OCR_RUNNER=python
OCR_PYTHON_BIN=python
```

On Windows the command is `python` (or `py`), **not** `python3`, which is the default value in the file. Restart the portal afterwards.

---

## 10. Optional: let other computers on the school network use it

By default only **this** PC can open the portal (`HOST=127.0.0.1`). Other computers on the same network need three things.

1. In `backend\.env` set `HOST=0.0.0.0` and restart the portal.
2. When it starts, the window now also prints this PC's network addresses, for example:

```
Also reachable on this network at:
  http://192.168.1.20:5000
```

   Use the address it prints. (If it prints *"No LAN network interface detected"*, connect the PC to the school network and restart the portal.)
3. The first time, Windows Defender Firewall asks whether to allow `node.exe`. Allow it on **Private networks** only. (If the question never appeared or you clicked Cancel, open *Windows Security → Firewall & network protection → Allow an app through firewall* and tick **Node.js JavaScript Runtime** for Private.)

Other computers then open the printed address followed by `/login.html`, for example `http://192.168.1.20:5000/login.html`. The portal automatically accepts requests that come to this PC's own network addresses; you only need `FRONTEND_ORIGIN` if you give the school a real domain name later (see [CONFIGURATION.md](CONFIGURATION.md#frontend_origin)).

> **Important:** over plain `http://` passwords and student records travel unencrypted. That is acceptable for testing with made-up data on a trusted network. **Real school data should be served over HTTPS** through a properly configured reverse proxy. See [SECURITY.md](SECURITY.md) and the README production checklist. If you browse over plain HTTP on a LAN and cannot stay signed in, see the cookie note in the [FAQ](FAQ.md#i-sign-in-but-the-portal-sends-me-back-to-the-login-page).

---

## 11. Backups and restore

Back up **both** the database and the pictures uploaded by the news team (`frontend\uploads`, if that folder exists).

### Back up the database

```powershell
mysqldump -u root -p --databases nnss_calabar --routines --result-file="C:\nnss-backups\nnss_backup.sql"
```

Create the folder first if it does not exist: `New-Item -ItemType Directory C:\nnss-backups`. Use a new file name each time, for example one with the date.

> **Do not use `>` to save a backup in PowerShell** (for example `mysqldump ... > backup.sql`). Windows PowerShell 5.1 writes that file in a different text encoding (UTF-16) and MySQL **cannot restore it**. Always use `--result-file=` as above.

### Restore a backup

```powershell
mysql -u root -p -e "SOURCE C:/nnss-backups/nnss_backup.sql"
```

(Forward slashes, and no quotes around the path.) Restoring replaces the current contents of `nnss_calabar` with the backup, so only do it when you mean to.

### Back up the news-team pictures

```powershell
Copy-Item C:\nnss\frontend\uploads C:\nnss-backups\uploads -Recurse
```

Keep backups on a **different drive or computer** from the portal, and treat them as confidential: they contain student records.

---

## 12. Updating to a newer version

1. **Back up first** (section 11).
2. Stop the portal (section 8).
3. From the project folder:

```powershell
git pull
cd backend
npm install
```

(If you downloaded a ZIP, download the new ZIP and copy your `backend\.env` file and `frontend\uploads` folder into it.)

4. **Existing databases only:** if the release notes say a database update is needed, apply **only** the numbered `database\00N_*.sql` file(s) it names, for example:

```powershell
mysql -u root -p nnss_calabar -e "SOURCE database/006_news_team_requests_contacts.sql"
```

Do **not** re-run the whole `schema.sql` on a live database without a backup. A fresh installation never needs the numbered files.

5. Start the portal again.

---

## 13. Troubleshooting (Windows)

| What you see | Why | What to do |
|---|---|---|
| `node` / `npm` is not recognized | Not installed, or the window is older than the install | Install Node.js (3.2), then close PowerShell and open a **new** one. |
| `npm.ps1 cannot be loaded because running scripts is disabled` | PowerShell script policy | Run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`, or use `npm.cmd`. See 3.2. |
| `mysql` is not recognized | MySQL's installer does not add it to PATH | Add its `bin` folder to PATH ([Appendix A](#appendix-a-add-a-folder-to-path)), open a **new** window. |
| `uv` is not recognized | Installed after the window opened, or its folder is not on PATH | Open a **new** window; else add `C:\Users\YourName\.local\bin` to PATH. |
| `The '<' operator is reserved for future use` | PowerShell does not support `<` redirection | Use `mysql -u root -p -e "SOURCE database/schema.sql"` (section 5.1). |
| `ERROR 1045 (28000): Access denied for user` | Wrong password, or `#` or spaces in the password in `.env` without quotes | Retype the password; quote it in `.env`. Test it with `mysql -u nnss_user -p`. |
| `ERROR 1044 ... Access denied ... to database 'xyz'` | The database name is misspelled, or the user has no rights on it | Check spelling (it is `nnss_calabar`). List databases with `mysql -u root -p -e "SHOW DATABASES;"`. |
| `ERROR 2003 Can't connect to MySQL server on '127.0.0.1'` | The MySQL service is stopped | `Get-Service *mysql*`; start it from an **administrator** PowerShell: `Start-Service MySQL80`. |
| `ERROR 1049 Unknown database 'nnss_calabar'` | Schema not loaded yet | Do section 5.1. |
| `ERROR 1064 ... syntax ... IF NOT EXISTS` while loading the schema | You are using an older copy of `schema.sql` | `git pull` to get the fixed file (it works on MySQL 8 and MariaDB). |
| Server stops and says `JWT_SECRET must be a unique random secret...` | Missing, short (<32 characters) or placeholder secret | Generate one (6.2) and paste it after `JWT_SECRET=` with no quotes or spaces. |
| Server stops and says `DB_PASSWORD is still a placeholder` | `DB_PASSWORD` was not changed | Put the real `nnss_user` password in `.env`. |
| `Error: listen EADDRINUSE: address already in use :::5000` | Another program (or a second copy of the portal) uses port 5000 | Close the other copy, or set `PORT=5001` in `.env` and open `http://localhost:5001`. Find the user of the port: `netstat -ano \| findstr :5000`. |
| The settings in `.env` seem ignored | The file is `.env.txt`, or you started the server from the wrong folder | Check 6.4. Always run `npm start` from the `backend` folder. |
| Browser shows "This site can't be reached" | The portal is not running | Run `npm start` (section 7) and keep that window open. |
| Browser shows a login page but "Invalid user ID or password" | Wrong ID/password, or the seed was never run | Run `npm run seed:admin` again with the values in `.env`; it resets that account's password. |
| Login works then immediately logs out (LAN use) | Secure cookies over plain HTTP | See the [FAQ](FAQ.md#i-sign-in-but-the-portal-sends-me-back-to-the-login-page). |
| Another computer cannot open the portal | `HOST` still `127.0.0.1`, or the firewall blocks it | Section 10. |
| `npm install` ends in red `npm ERR!` | No internet, a proxy, or a corrupted download | Check the connection, then `npm cache clean --force` and run `npm install` again. |
| Scanner problems | See the table in [9.2](#92-if-the-scanner-says-it-is-not-available). | |

Still stuck? Copy the **exact** red text and the command that produced it, remove any passwords, and use the [FAQ](FAQ.md) or ask the person who maintains the portal.

---

## Appendix A: add a folder to PATH

**Option 1: with PowerShell (no administrator needed).** Replace the folder in the first line with the one you want to add, then run all four lines:

```powershell
$folder = "C:\Program Files\MySQL\MySQL Server 8.0\bin"
$old = [Environment]::GetEnvironmentVariable("Path", "User")
if ($old -notlike "*$folder*") { [Environment]::SetEnvironmentVariable("Path", "$old;$folder", "User") }
"Done. Now close PowerShell and open a new one."
```

This adds the folder for **your Windows account** only, and leaves everything already on PATH untouched.

**Option 2: with the Windows screens.**

1. Press the **Windows key**, type `environment`, choose **Edit environment variables for your account**.
2. Select **Path** in the top list and click **Edit…**.
3. Click **New**, paste the folder (for example `C:\Program Files\MySQL\MySQL Server 8.0\bin`), press Enter.
4. Click **OK** on every window. Close PowerShell and open a new one.

**Check it worked** (in the new window), for example for MySQL:

```powershell
mysql --version
```

## Appendix B: find where a program is installed

If a program is installed but PowerShell cannot find it, locate it:

```powershell
# a program already on PATH
(Get-Command node).Source

# search a folder for a program by file name
Get-ChildItem "C:\Program Files" -Recurse -Filter mysql.exe -ErrorAction SilentlyContinue | Select-Object -First 3 FullName
```

Then add the **folder that contains it** (not the `.exe` file itself) with Appendix A. Usual file names: `mysql.exe`, `node.exe`, `uv.exe`, `tesseract.exe`.

## Appendix C: start completely over

This **deletes the portal's database and every record in it**. Only do it on a test installation, or after a backup.

```powershell
mysql -u root -p -e "DROP DATABASE IF EXISTS nnss_calabar;"
mysql -u root -p -e "SOURCE database/schema.sql"
cd backend
npm run seed:admin
```

You then need to re-create the `nnss_user` grants only if you also dropped that user; dropping the database alone keeps them.
