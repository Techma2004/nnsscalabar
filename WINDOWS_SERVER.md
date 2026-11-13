# NNSS Calabar Portal — Windows Server 2025 deployment guide

For the school's IT administrator. This guide turns the portal into an unattended, HTTPS-served Windows service on **Windows Server 2025 (x64)**. Allow about 60–90 minutes. It assumes Desktop Experience unless stated, and an install root of `C:\nnss` (no spaces, not in OneDrive, not in a redirected profile).

> **Honesty statement — read first.** This guide has **not been validated on a live Windows Server 2025 installation.** It was written from the application's source code and from vendor documentation. Work through [section 11](#11-go-live-verification-checklist) on the 180-day evaluation ISO (section 2) **before go-live**, and record the results. Where a step turns out to differ on a real server, trust the server and correct this document.

This is a **companion** to [WINDOWS_SETUP.md](WINDOWS_SETUP.md), not a replacement. Its PATH rules (open a **new** window after installing anything), its `.env` rules, and its PowerShell workaround for `SOURCE` all still apply; they are linked, not repeated, below.

---

## 0. What is different from a Windows PC

| On a Windows PC (WINDOWS_SETUP.md) | On the server (this guide) |
|---|---|
| `npm start` in a window | A Windows **service** that starts at boot and restarts on failure |
| `http://localhost:5000` | **HTTPS on port 443** through a reverse proxy; Node listens on loopback only |
| Firewall popup, click Allow | Explicit **inbound rules** for 80 and 443 only |
| Backups when you remember | A **Scheduled Task** every night, with a tested restore |
| Your own account runs everything | A **least-privilege service account** |

None of this requires changing the application code.

---

## 1. Requirements and support matrix

| Item | Requirement |
|---|---|
| OS | Windows Server 2025 x64 (Standard, Datacenter, Datacenter: Azure Edition or Essentials). General availability 2024-11-01; mainstream support ends 2029-11-14, extended support ends 2034-11-15 (Microsoft Lifecycle). |
| Node.js | 20 or newer. Node lists Windows x64 (Windows 10 / Server 2016 and newer) as **Tier 1** (full CI coverage), so Server 2025 is fully supported. |
| Database | MySQL 8+ or MariaDB 10.6+ |
| Reverse proxy | Caddy for Windows (simplest, this guide), or IIS + Application Request Routing + win-acme |
| Service wrapper | NSSM (this guide) or WinSW |
| Hardware | 4 GB RAM, 40 GB disk is enough for a test server; size production for your student count |
| Compiler | **Not needed.** `bcryptjs` is pure JavaScript. |

Server 2025 specifics that matter here: WinGet is installed by default on **Desktop Experience** and is **not officially supported on Server Core** (use offline installers there; no GUI either). OpenSSH server is installed by default. SMB signing is required by default for outbound connections and Credential Guard is on where hardware supports it; neither affects a Node app bound to loopback. There is no product called "Windows Server 25"; it is **Windows Server 2025**.

---

## 2. Get a test server first

1. Download the **180-day evaluation ISO** from the Microsoft Evaluation Center.
2. Create a VM in Hyper-V or VirtualBox with 4 GB RAM and 40 GB disk.
3. Build the whole stack there, and complete section 11, **before** touching the school's real server.

---

## 3. Install the software

Open PowerShell **as Administrator**:

```powershell
winget install -e --id Git.Git
winget install -e --id OpenJS.NodeJS.LTS
```

Close the window and open a new one (WINDOWS_SETUP.md section 0), then check `node --version` (20 or newer) and `git --version`.

**Database.** Install MySQL 8+ or MariaDB 10.6+ from the vendor's official installer. Keep the port at **3306**, set a strong root password, keep **"configure as a Windows service"** and **"start at system startup"** ticked, and **write down the service name** you are shown. You need it in section 6. (WINDOWS_SETUP.md section 3.3 walks through the MySQL installer.)

Verify:

```powershell
Get-Service *mysql*,*mariadb*
```

Note the exact `Name` column; MySQL's installer commonly uses `MySQL80`, but use whatever you see. `mysql.exe` is **still not on PATH**; use its full path or the installer's "MySQL Command Line Client" shortcut, as in WINDOWS_SETUP.md.

**Service wrapper and proxy.**

```powershell
winget install -e --id CaddyServer.Caddy
```

Download NSSM from <https://nssm.cc/download> and put `nssm.exe` (the 64-bit one) in a folder on the **machine** PATH, for example `C:\Tools`. (I could not confirm a WinGet package ID for NSSM, so this guide does not give one.) On Server Core, download the installers/zips on another machine and copy them across.

Optional, only for the AI scanner: uv and Tesseract; read [section 9](#9-the-ai-scanner-under-a-service-account) first.

---

## 4. Database

Follow **WINDOWS_SETUP.md section 5** exactly (create the schema, create `nnss_user` for `localhost` and `127.0.0.1`, and use its PowerShell-safe `SOURCE` form rather than `<` redirection). Then verify:

- **26** tables and views exist in the database.
- Signed in as `nnss_user`, the `posts` table has **13** rows.

**Windows versus Linux.** MySQL on Windows defaults to `lower_case_table_names=1` (names are stored lowercase); on Linux the default is `0` (case-sensitive). Keep every table name **lowercase** and the two behave the same.

**Migrating from the Linux install.** Dump on Linux with `mariadb-dump` (or `mysqldump`) to a `.sql` file, copy the file, and restore it with `SOURCE`. **Never copy the raw database data directory between operating systems.**

---

## 5. Application and production `.env`

```powershell
cd C:\
git clone https://github.com/Techma2004/nnsscalabar.git nnss
cd C:\nnss\backend
npm install
copy .env.example .env
```

Generate the secret (this uses the same command as WINDOWS_SETUP.md section 6; 32 random bytes is already well above the 32-character minimum the server enforces; use 48 if you prefer a longer one):

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Production `backend\.env`:

```ini
NODE_ENV=production
PORT=5000
HOST=127.0.0.1
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=nnss_user
DB_PASSWORD=<the unique password you set>
DB_NAME=nnss_calabar
JWT_SECRET=<the generated secret>
TRUST_PROXY_HOPS=1
FRONTEND_ORIGIN=https://portal.yourschool.ng
```

- `HOST=127.0.0.1` is **deliberate**: only the reverse proxy talks to Node; nothing else can reach port 5000.
- With `NODE_ENV=production`, **`COOKIE_SECURE` becomes true automatically** (you do not set it). That means the portal only works over HTTPS; plain `http://` sign-in will appear to log you in and then log you straight out.
- `TRUST_PROXY_HOPS=1` is correct for **one** proxy (Caddy) in front of Node. Too low and every user shares the proxy's address in the rate limiter; too high lets clients spoof their address. Never set more hops than proxies you actually run.
- The server **refuses to start** if `JWT_SECRET` or `DB_PASSWORD` is still a placeholder.
- Replace `portal.yourschool.ng` with your real name. For multiple allowed origins, `FRONTEND_ORIGIN` takes a comma-separated list.

**Seed the first Commandant**, then remove the bootstrap password:

1. Add to `.env`: `INITIAL_COMMANDANT_CODE=CMD001` and `INITIAL_COMMANDANT_PASSWORD=<strong, 8+ characters>`.
2. Run `npm run seed:commandant`.
3. **Delete both `INITIAL_COMMANDANT_*` lines** from `.env`.

Never commit `.env`. It is git-ignored; keep it that way.

---

## 6. Run as a Windows service (NSSM)

This is the most important section.

```powershell
New-Item -ItemType Directory -Force C:\nnss-logs

nssm install NNSSPortal "C:\Program Files\nodejs\node.exe" "server.js"
nssm set NNSSPortal AppDirectory C:\nnss\backend
nssm set NNSSPortal DisplayName "NNSS Calabar Portal"
nssm set NNSSPortal Start SERVICE_AUTO_START
nssm set NNSSPortal DependOnService MySQL80
nssm set NNSSPortal AppStdout C:\nnss-logs\portal.log
nssm set NNSSPortal AppStderr C:\nnss-logs\portal-error.log
nssm set NNSSPortal AppRotateFiles 1
nssm set NNSSPortal AppRotateBytes 10485760
nssm set NNSSPortal AppExit Default Restart
nssm set NNSSPortal AppRestartDelay 5000
nssm start NNSSPortal
```

**Replace `MySQL80` with the service name you recorded in section 3.** `DependOnService` is essential: without it Windows may start the portal before the database, and every reboot produces a connection error (`ECONNREFUSED`).

`AppDirectory` must be `C:\nnss\backend`, because the server loads `backend\.env` from its working directory.

Verify:

```powershell
Get-Service NNSSPortal                       # Running, Automatic
Get-Content C:\nnss-logs\portal.log -Tail 20 # look for: Database connection: OK
Invoke-RestMethod http://127.0.0.1:5000/api/health
```

The health call should return `status: ok` and `database: connected`.

The application shuts down gracefully on SIGTERM/SIGINT (with a 10-second forced exit), so stopping or restarting the service is safe.

> **Run exactly one instance.** Rate limiting uses an in-memory store (`express-rate-limit`). Two instances would each keep their own counters and the limits would no longer be enforced as documented. Running more than one needs a shared store such as Redis first.

---

## 7. HTTPS and firewall

### 7.1 Caddy (public domain, automatic certificates)

Create `C:\nnss\Caddyfile`:

```
portal.yourschool.ng {
    reverse_proxy 127.0.0.1:5000
}
```

Caddy obtains and renews the certificate automatically. This needs a real public DNS name pointing at the server and ports 80 and 443 reachable from the internet.

Run Caddy as a service. Caddy's own documentation describes `sc.exe` and WinSW; NSSM works the same way as for the portal:

```powershell
nssm install Caddy "C:\Program Files\Caddy\caddy.exe" "run --config C:\nnss\Caddyfile"
nssm set Caddy Start SERVICE_AUTO_START
nssm set Caddy DependOnService NNSSPortal
nssm set Caddy AppStdout C:\nnss-logs\caddy.log
nssm set Caddy AppStderr C:\nnss-logs\caddy-error.log
nssm start Caddy
```

(Check the real path with `Get-Command caddy`; WinGet may install it elsewhere. Windows services cannot be "reloaded"; after editing the Caddyfile, run `caddy reload --config C:\nnss\Caddyfile` or restart the service.)

**Certificate storage.** Caddy keeps certificates and keys in its data folder, which on Windows defaults to `%AppData%\Caddy` of **the account that runs it** (or `$XDG_DATA_HOME\caddy` if that variable is set). Running Caddy under the same dedicated account every time keeps that location predictable. **Confirm that certificates survive a reboot:** after restarting the server, check the Caddy log shows it reused the existing certificate instead of requesting a new one (repeated new requests can hit the certificate authority's rate limits).

### 7.2 LAN-only variant (Caddy `tls internal`)

If the portal is only reachable inside the school, use a name that resolves on your LAN and let Caddy issue from its own private CA:

```
portal.school.lan {
    tls internal
    reverse_proxy 127.0.0.1:5000
}
```

Each client device must **trust Caddy's root certificate** or browsers will show a warning (and a secure-cookie portal behind an untrusted certificate is a poor experience). Export the root certificate from Caddy's data folder (`pki\authorities\local\root.crt`) and install it as a Trusted Root on client devices; it can be deployed by **Group Policy**. `FRONTEND_ORIGIN` must exactly match the address users type, for example `https://portal.school.lan`.

### 7.3 Alternative: IIS + ARR + win-acme

IIS with Application Request Routing as the reverse proxy and win-acme for Let's Encrypt certificates also works. The Node side is unchanged (loopback, `TRUST_PROXY_HOPS=1`, one instance). This guide does not give IIS steps.

### 7.4 Firewall

Open **443 and 80 only**. **Never expose 5000 or 3306.**

```powershell
New-NetFirewallRule -DisplayName "NNSS HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
New-NetFirewallRule -DisplayName "NNSS HTTP (certificate challenge/redirect)" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
```

Do not create rules for ports 5000 or 3306. Node and the database already listen on loopback only; the firewall is a second layer. For a LAN-only server, scope the rules to your school subnet with `-RemoteAddress`.

---

## 8. Service account and folder permissions

`chmod` does not exist on Windows; access is controlled by ACLs (`icacls`). Create a dedicated, non-administrator local user and give it only what it needs:

```powershell
$pw = Read-Host "Service account password" -AsSecureString
New-LocalUser -Name svc-nnss -Password $pw -PasswordNeverExpires -UserMayNotChangePassword -Description "NNSS portal service"

New-Item -ItemType Directory -Force C:\nnss\frontend\uploads | Out-Null
icacls C:\nnss\frontend\uploads /grant "svc-nnss:(OI)(CI)M"
icacls C:\nnss-logs             /grant "svc-nnss:(OI)(CI)M"
icacls C:\nnss\backend\.env     /grant "svc-nnss:R"
icacls C:\nnss                  /grant "svc-nnss:(OI)(CI)RX"
```

The account also needs the **"Log on as a service"** right (Local Security Policy → Local Policies → User Rights Assignment); NSSM normally grants it for you when you set the account, but check. Then:

```powershell
nssm set NNSSPortal ObjectName ".\svc-nnss" "<the password>"
nssm restart NNSSPortal
```

Keep `.env` readable only by administrators and this account (remove inherited access for `Users` if present). The uploads folder is created on demand by the app (`frontend\uploads`), but create it yourself so you control its ACLs.

> **Test a news-team picture upload.** Sign in as an editor (news-team) user and upload a post picture (PNG, JPEG or WebP, up to 2.5 MB). That is the test that proves the ACLs are right. Reading pages working proves nothing about write access.

---

## 9. The AI scanner under a service account

> **This is the one issue with no equivalent on a desktop PC. Read it before enabling scanning.** Scanning is **optional**; the rest of the portal works without it.

`uv` installs under `%USERPROFILE%\.local\bin`, a **per-user** PATH entry. A service running as LocalSystem or as `svc-nnss` has a **different profile** and will never see it, so the scanner reports **"uv not found"** even though `uv --version` works in your own shell. Tesseract has the same problem. uv's Python and library cache is also per-profile.

Pick one fix:

**(a) Machine-wide PATH plus explicit `TESSERACT_CMD`, then reboot.** Add the folders holding `uv.exe` and `tesseract.exe` to the **system** PATH (System Properties → Environment Variables → System variables) and set in `backend\.env`:

```ini
TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
```

Reboot so the service inherits the new PATH.

**(b) Install uv as the service account.** Sign in (or run a shell via `runas`) as `svc-nnss` and install uv there so it lands in that account's profile.

**(c) Skip uv: `OCR_RUNNER=python`.** Install the Python dependencies yourself and give the full interpreter path:

```ini
OCR_RUNNER=python
OCR_PYTHON_BIN=C:\Python313\python.exe
```

Install the packages with that interpreter: `python -m pip install pytesseract "Pillow>=13.0.0" opencv-python-headless numpy pypdfium2` (this is the list in WINDOWS_SETUP.md section 9.3 and `pyproject.toml`).

**Pre-warm the cache.** uv's Python and library cache is per-profile, so the first scan under the service account may download and install things and be slow. Either run **one manual scan as the service account** to warm it, or raise the timeout:

```ini
OCR_TIMEOUT_MS=120000
```

(The default is 60000 ms.) With the `uv` runner, uv also builds a `.venv` in the repository root, so the service account needs Modify access on `C:\nnss\.venv` (create the folder first and grant it with `icacls`, as in section 8), or run `uv sync` once as that account.

The scanner's readiness is checked by `/api/results/ai-status`, whose result is **cached for 30 seconds**: after you fix PATH or install Tesseract, allow up to half a minute before the portal shows the scanner as ready.

---

## 10. Scheduled backups

Create `C:\nnss\backup.ps1`. **Credentials must not be hard-coded in the script.** Put them in a MySQL option file readable only by the service account (for example `C:\nnss-backup\backup.cnf`, with `[client]` `user=`, `password=`), and pass it with `--defaults-extra-file`:

```powershell
$ErrorActionPreference = "Stop"
$stamp  = Get-Date -Format "yyyyMMdd-HHmmss"
$dest   = "D:\nnss-backups"                      # a DIFFERENT drive or machine
$dump   = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe"   # adjust to your install
New-Item -ItemType Directory -Force $dest | Out-Null

& $dump --defaults-extra-file=C:\nnss-backup\backup.cnf --single-transaction --routines `
        --result-file="$dest\nnss-$stamp.sql" YOUR_DATABASE_NAME
if ($LASTEXITCODE -ne 0) { throw "mysqldump failed" }

robocopy C:\nnss\frontend\uploads "$dest\uploads-$stamp" /E /NFL /NDL /NJH /NJS | Out-Null

Get-ChildItem $dest | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item -Recurse -Force
```

> **Never use `>` to write a dump in Windows PowerShell 5.1.** It writes **UTF-16**, and MySQL cannot restore it. Always use `--result-file=`.

Register it for 02:00 daily, running as the service account whether or not anyone is logged in:

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File C:\nnss\backup.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At 2:00am
Register-ScheduledTask -TaskName "NNSS Backup" -Action $action -Trigger $trigger `
  -User ".\svc-nnss" -Password "<the password>" -RunLevel Limited
```

The account needs the **"Log on as a batch job"** right and write access to the backup folder. Back up to a **different drive or machine**. Backups contain **confidential student data**: restrict their ACLs and never commit them to Git. **Test a restore** on the test server (`SOURCE` the dump into an empty database, as in WINDOWS_SETUP.md section 5) and confirm the portal reads it.

---

## 11. Go-live verification checklist

Tick every box on the evaluation ISO first, then again on the real server.

- [ ] `Get-Service NNSSPortal` is **Running / Automatic**; `Caddy` likewise.
- [ ] **Reboot the server and confirm everything comes back unattended** (no one logs in).
- [ ] `https://<your domain>/api/health` returns `ok` over a valid HTTPS certificate.
- [ ] Sign in as **each role** (the portal has six: student, teacher, HOD, admin, Commandant and the news-team/editor role; create a test account for each).
- [ ] The session persists across page loads (no instant logout).
- [ ] A teacher enters a result → HOD approves → the **student sees the result**.
- [ ] A **picture upload** works (proves ACLs, section 8).
- [ ] **Excel import and export** work.
- [ ] One **OCR scan** works, if you enabled it.
- [ ] A backup ran and a **restore was tested**.
- [ ] Ports **5000 and 3306 are unreachable** from another machine (`Test-NetConnection <server> -Port 5000`).
- [ ] Bootstrap passwords are removed from `.env`, and `.env` is **not in Git**.
- [ ] `cd backend && npm test` passes.

Record the date, who ran it, and any step that needed changing.

---

## 12. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Service starts, then stops | Placeholder `JWT_SECRET` or `DB_PASSWORD`, or a missing `.env`. **Read `C:\nnss-logs\portal-error.log`.** |
| `ECONNREFUSED` after reboot | The portal started before the database. Set `DependOnService` to the real DB service name (section 6). |
| Works in PowerShell but not as a service | Wrong `AppDirectory`, or a per-user PATH the service cannot see (section 9). |
| Sign in works, then instantly logged out | `NODE_ENV=production` over plain HTTP (the cookie is Secure). Use HTTPS. |
| CORS / 403 errors after moving to a domain | `FRONTEND_ORIGIN` does not exactly match the address in the browser. |
| Everyone gets "too many requests" at once | `TRUST_PROXY_HOPS=0` behind a proxy: all users share the proxy's address. Set it to `1` (see [FAQ](FAQ.md)). |
| Uploads fail | ACLs on `frontend\uploads` (section 8). |
| "uv not found" in the scanner | Section 9. |
| `'mysql' is not recognized` | `mysql.exe` is not on PATH; use its full path (WINDOWS_SETUP.md). |
| `'winget' is not recognized` | Server Core has no official WinGet; use offline installers. |

---

## 13. Alternative: Ubuntu LTS in Hyper-V

Windows Server 2025 can host the existing Ubuntu LTS install as a **Generation 2 Hyper-V VM** with **no application changes**. This is a legitimate production pattern. Choose it only if the school explicitly wants a Linux guest. (Ubuntu LTS has 5 years of standard updates, extendable to 10 with Ubuntu Pro.)
