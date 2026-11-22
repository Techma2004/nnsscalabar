# Running the portal day to day

For people who already installed it ([INSTALL.md](INSTALL.md) for a PC, [SERVER.md](SERVER.md) for a server). Online with Vercel needs almost none of this: Vercel keeps it running; see the backup and update notes at the end of each section.

## Contents

- [Start, stop, restart](#start-stop-restart)
- [Start automatically when the computer starts](#start-automatically-when-the-computer-starts)
- [Check that it is healthy](#check-that-it-is-healthy)
- [Backups and restore](#backups-and-restore)
- [Update to a newer version](#update-to-a-newer-version)
- [Passwords and accounts](#passwords-and-accounts)
- [Start completely over](#start-completely-over)

---

## Start, stop, restart

| I want to... | PC (started by hand) | Server (service) |
|---|---|---|
| Start | `cd backend` then `npm start` (keep the window open) | Linux: `sudo systemctl start nnss-portal`. Windows: `nssm start NNSSPortal` |
| Stop | `Ctrl + C` in that window | Linux: `sudo systemctl stop nnss-portal`. Windows: `nssm stop NNSSPortal` |
| Restart after changing `.env` | Stop, then start | Linux: `sudo systemctl restart nnss-portal`. Windows: `nssm restart NNSSPortal` |
| See what it is doing | The window output | Linux: `journalctl -u nnss-portal -f`. Windows: `Get-Content C:\nnss-logs\portal.log -Tail 50 -Wait` |

`.env` is read only when the portal starts, so every settings change needs a restart. On Vercel, change the variable and click **Redeploy**.

## Start automatically when the computer starts

A school PC does not start the portal by itself unless you set this up. The database service starts automatically with the computer.

**Linux:** use the systemd service in [SERVER.md section 5](SERVER.md#5-run-it-as-a-service). It works the same on a PC (change `User=` to your own user name and the paths to your project folder).

**Windows:** use the NSSM service in [SERVER.md section 5](SERVER.md#5-run-it-as-a-service), or for a simple PC a scheduled task that runs at start-up:

```powershell
$action  = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c cd /d C:\nnss\backend && npm start" 
$trigger = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -TaskName "NNSS Portal" -Action $action -Trigger $trigger -RunLevel Highest
```

**macOS:** the simplest way is `pm2`:

```bash
npm install -g pm2
cd ~/nnsscalabar/backend
pm2 start server.js --name nnss-portal
pm2 save
pm2 startup        # run the command it prints
```

## Check that it is healthy

```bash
curl http://127.0.0.1:5000/api/health        # {"status":"ok"}
```

On Windows use `Invoke-RestMethod http://127.0.0.1:5000/api/health`. Online, open `https://<your-domain>/api/health`. When the portal starts its log must say `Database connection: OK`. Signed in as an administrator, `/api/admin/health` shows more detail.

## Backups and restore

Back up **two things**: the database, and the pictures the news team uploaded (`frontend/uploads/`, if that folder exists). Keep copies on a **different drive or computer**, and treat them as confidential: they contain student records. **Test a restore** before you rely on a backup.

### Back up the database (PC or server)

**Linux / macOS**

```bash
mkdir -p ~/nnss-backups
pg_dump -h 127.0.0.1 -U nnss_user -d nnss_calabar -F c -f ~/nnss-backups/nnss-$(date +%F).dump
cp -r frontend/uploads ~/nnss-backups/uploads-$(date +%F) 2>/dev/null
```

**Windows (PowerShell)**

```powershell
New-Item -ItemType Directory -Force C:\nnss-backups | Out-Null
$d = Get-Date -Format "yyyy-MM-dd"
& "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -h 127.0.0.1 -U nnss_user -d nnss_calabar -F c -f "C:\nnss-backups\nnss-$d.dump"
Copy-Item C:\nnss\frontend\uploads "C:\nnss-backups\uploads-$d" -Recurse -ErrorAction SilentlyContinue
```

It asks for the `nnss_user` password. `-F c` makes a compact file for `pg_restore`; `-f` writes the file itself, so it is safe in PowerShell (do **not** use `>`).

### Restore a backup

First practise on a **new, empty database** so nothing live is touched:

```bash
sudo -u postgres psql -c "CREATE DATABASE nnss_restore_test OWNER nnss_user;"     # macOS: psql postgres -c "..."
pg_restore -h 127.0.0.1 -U nnss_user -d nnss_restore_test --no-owner ~/nnss-backups/nnss-2026-11-22.dump
psql -h 127.0.0.1 -U nnss_user -d nnss_restore_test -c "SELECT count(*) FROM users;"
```

(Windows: use the full `psql.exe` / `pg_restore.exe` paths and the `postgres` password prompt.) When it works, drop the test database (`DROP DATABASE nnss_restore_test;`).

To restore **over the live database** (this replaces its contents; stop the portal first):

```bash
pg_restore -h 127.0.0.1 -U nnss_user -d nnss_calabar --clean --if-exists --no-owner ~/nnss-backups/nnss-2026-11-22.dump
```

### Automatic nightly backup

Without typing the password each time, store it for the backup user only:

- **Linux / macOS:** put `127.0.0.1:5432:nnss_calabar:nnss_user:YourDbPassword` in `~/.pgpass` and run `chmod 600 ~/.pgpass`.
- **Windows:** put the same line in `%APPDATA%\postgresql\pgpass.conf`.

Linux / macOS, every night at 02:00 (`crontab -e`), keeping 30 days:

```cron
0 2 * * * pg_dump -h 127.0.0.1 -U nnss_user -d nnss_calabar -F c -f $HOME/nnss-backups/nnss-$(date +\%F).dump && find $HOME/nnss-backups -name 'nnss-*.dump' -mtime +30 -delete
```

Windows: save the three backup lines above as `C:\nnss\backup.ps1`, then:

```powershell
$a = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File C:\nnss\backup.ps1"
$t = New-ScheduledTaskTrigger -Daily -At 2:00am
Register-ScheduledTask -TaskName "NNSS Backup" -Action $a -Trigger $t
```

### Online (Supabase)

Daily backups are a Supabase paid-plan feature (check what your plan includes); do not rely on a free project having any. Either upgrade, or run `pg_dump` yourself from your computer against the **session pooler or direct** connection string (Connect button; **not** the port 6543 transaction string, which `pg_dump` cannot use), for example:

```bash
pg_dump "postgresql://postgres.<ref>:<password>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" -F c -f nnss-supabase.dump
```

(Encode special characters in the password as described in [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md#1-supabase-database).) Pictures on R2 are stored by Cloudflare; copy the bucket if you need an extra copy.

## Update to a newer version

1. **Back up first** (above).
2. Stop the portal.
3. In the project folder:

   ```bash
   git pull
   cd backend
   npm install
   ```

   (Downloaded a ZIP instead? Unzip the new version and copy your `backend/.env` and `frontend/uploads/` into it.)
4. If the release notes say a database change is needed, run **only** the SQL file they name, with `psql -h 127.0.0.1 -U nnss_user -d nnss_calabar -f <file>`. A fresh install never needs any extra file. Re-running `database/postgres/schema.sql` is safe (it only adds what is missing) but does not change existing tables.
5. Start the portal.

**Vercel:** merge to `main` and Vercel redeploys by itself. Database changes are applied by running the SQL in the Supabase SQL Editor.

Keep the root `package.json` in step with `backend/package.json` whenever you add or upgrade a package: Vercel installs from the root one.

## Passwords and accounts

- **Admin or Commandant forgot the password:** set `INITIAL_ADMIN_PASSWORD` (or `INITIAL_COMMANDANT_PASSWORD`) in `backend/.env` and run `npm run seed:admin` (or `npm run seed:commandant`) from `backend`. It resets the password, turns the account on and signs out its other sessions. Remove the password from `.env` afterwards. Online, run it on your own computer with `DATABASE_URL` pointing at Supabase.
- **Anyone else:** an administrator or the Commandant sets a new password in **Account Management**.
- **"Too many sign-in attempts":** 10 attempts per account and address in 15 minutes; wait and try again.

## Start completely over

This **deletes all data**. Back up first.

```bash
sudo -u postgres psql -c "DROP DATABASE nnss_calabar;" -c "CREATE DATABASE nnss_calabar OWNER nnss_user;"
psql -h 127.0.0.1 -U nnss_user -d nnss_calabar -f database/postgres/schema.sql
cd backend && npm run seed:admin && npm run seed:commandant
```

(Windows: use the `postgres` session from [INSTALL.md section 5.1](INSTALL.md#51-open-a-database-administrator-session) for the first line.)
