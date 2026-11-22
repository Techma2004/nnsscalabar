# Run it on your own server

For a school that wants the portal reachable all day without depending on one office PC: a Linux server (Ubuntu / Debian) or a Windows Server, behind HTTPS. The Linux and Windows steps are side by side.

Prefer not to run a server? Use [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md) (online, managed). A PC at school is covered in [INSTALL.md](INSTALL.md).

> **Status of this guide.** The application, PostgreSQL setup and settings below were tested end to end. The service, nginx, Caddy and firewall steps follow each tool's standard setup but have **not** been tried on a live school server: test on a spare machine first and run the checklist in section 9.

## Contents

1. [How it fits together](#1-how-it-fits-together)
2. [Prepare the server](#2-prepare-the-server)
3. [Install the portal](#3-install-the-portal)
4. [Production settings](#4-production-settings-backendenv)
5. [Run it as a service](#5-run-it-as-a-service)
6. [HTTPS and the reverse proxy](#6-https-and-the-reverse-proxy)
7. [Firewall](#7-firewall)
8. [Backups](#8-backups)
9. [Go-live checklist](#9-go-live-checklist)
10. [Using Supabase from your own server](#10-using-supabase-from-your-own-server)

---

## 1. How it fits together

```text
Internet / school network
        |  HTTPS (443)
   nginx (Linux)  or  Caddy (Windows)       <- the only thing users can reach
        |  http://127.0.0.1:5000
   Node.js portal (a service)               <- listens on this machine only
        |  127.0.0.1:5432
   PostgreSQL                               <- listens on this machine only
```

- Run **exactly one** portal process. Login rate limits are kept in memory and are not shared between processes.
- Only ports **80 and 443** are open. **Never** expose 5000 or 5432.

## 2. Prepare the server

| | **Linux (Ubuntu 22.04 / 24.04, Debian 12)** | **Windows Server 2022 / 2025** |
|---|---|---|
| Updates | `sudo apt update && sudo apt upgrade -y` | Install pending Windows updates |
| Tools | Same as [INSTALL.md section 3](INSTALL.md#3-install-the-programs): Git, Node.js 22, PostgreSQL | Same, using `winget` or the installers |
| Extra | `sudo apt install -y nginx certbot ufw` | Caddy: `winget install -e --id CaddyServer.Caddy`; NSSM from <https://nssm.cc> (put `nssm.exe` on PATH) |
| Dedicated account | `sudo useradd --system --home /opt/nnss --shell /usr/sbin/nologin nnss` | Create a local standard user `svc-nnss` (not an administrator) |

## 3. Install the portal

**Database:** follow [INSTALL.md section 5](INSTALL.md#5-create-the-database) exactly (create `nnss_user`, create `nnss_calabar`, load `database/postgres/schema.sql`). PostgreSQL listens on `127.0.0.1` by default: leave it that way.

**Code**

Linux:

```bash
sudo git clone https://github.com/Techma2004/nnsscalabar.git /opt/nnss
sudo chown -R nnss:nnss /opt/nnss
cd /opt/nnss/backend
sudo -u nnss npm install --omit=dev
sudo -u nnss cp .env.example .env
sudo chmod 600 .env
```

Windows (PowerShell, as an administrator):

```powershell
git clone https://github.com/Techma2004/nnsscalabar.git C:\nnss
cd C:\nnss\backend
npm install --omit=dev
Copy-Item .env.example .env
```

Then give the service account rights: **Modify** on `frontend\uploads` and the log folder, **Read** on `backend\.env`, nothing more.

## 4. Production settings (`backend/.env`)

```dotenv
NODE_ENV=production
PORT=5000
HOST=127.0.0.1
DATABASE_URL=postgres://nnss_user:YourDbPassword@127.0.0.1:5432/nnss_calabar
JWT_SECRET=<48+ random characters: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))">
COOKIE_SECURE=true
TRUST_PROXY_HOPS=1
FRONTEND_ORIGIN=https://portal.yourschool.ng
AI_SCORE_IMPORT_ENABLED=false
```

- `FRONTEND_ORIGIN` must be exactly the address people type, with `https://`. A wrong value gives **"Request not allowed."** at sign-in.
- `TRUST_PROXY_HOPS=1` means exactly one proxy (nginx or Caddy) in front. It must overwrite, not append, the forwarded address (the supplied nginx config does).
- Set `AI_SCORE_IMPORT_ENABLED=true` only after installing the scanner ([INSTALL.md section 9](INSTALL.md#9-optional-the-score-sheet-scanner-ocr)).
- All settings: [CONFIGURATION.md](CONFIGURATION.md).

Create the first accounts (set `INITIAL_*` values in `.env` first, then remove the password lines afterwards):

```bash
sudo -u nnss npm run seed:admin        # Linux
sudo -u nnss npm run seed:commandant
```

On Windows run `npm run seed:admin` and `npm run seed:commandant` in `C:\nnss\backend`.

## 5. Run it as a service

### Linux: systemd

Create `/etc/systemd/system/nnss-portal.service`:

```ini
[Unit]
Description=NNSS Calabar portal
After=network.target postgresql.service
Requires=postgresql.service

[Service]
User=nnss
WorkingDirectory=/opt/nnss/backend
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nnss-portal
systemctl status nnss-portal
journalctl -u nnss-portal -n 30 --no-pager      # look for: Database connection: OK
curl http://127.0.0.1:5000/api/health            # {"status":"ok"}
```

(`which node` shows the real path if it is not `/usr/bin/node`.) The working directory matters: the portal reads `.env` from where it starts.

### Windows: NSSM service

```powershell
New-Item -ItemType Directory -Force C:\nnss-logs
nssm install NNSSPortal "C:\Program Files\nodejs\node.exe" "server.js"
nssm set NNSSPortal AppDirectory C:\nnss\backend
nssm set NNSSPortal DisplayName "NNSS Calabar Portal"
nssm set NNSSPortal Start SERVICE_AUTO_START
nssm set NNSSPortal DependOnService postgresql-x64-16
nssm set NNSSPortal AppStdout C:\nnss-logs\portal.log
nssm set NNSSPortal AppStderr C:\nnss-logs\portal-error.log
nssm set NNSSPortal AppRotateFiles 1
nssm set NNSSPortal AppRotateBytes 10485760
nssm set NNSSPortal AppExit Default Restart
nssm set NNSSPortal AppRestartDelay 5000
nssm set NNSSPortal ObjectName ".\svc-nnss" "<the svc-nnss password>"
nssm start NNSSPortal
Invoke-RestMethod http://127.0.0.1:5000/api/health
```

Find the real database service name with `Get-Service postgresql*` and use it in `DependOnService`: without it Windows may start the portal before the database after a reboot. The portal shuts down gracefully when the service is stopped.

## 6. HTTPS and the reverse proxy

You need a name (for example `portal.yourschool.ng`) that points at the server's public address, with ports 80 and 443 reachable. No public name, LAN only? Use the school-CA route in [HTTPS.md](HTTPS.md#2-lan-with-no-public-domain-your-own-certificate-authority).

### Linux: nginx + Let's Encrypt

```bash
sudo mkdir -p /var/www/certbot
sudo cp /opt/nnss/deploy/nginx/nnss-portal.conf /etc/nginx/sites-available/nnss-portal
sudoedit /etc/nginx/sites-available/nnss-portal     # replace portal.school.lan with your name
```

Get the certificate first, then point the config at it (details and renewal: [HTTPS.md section 3](HTTPS.md#3-public-domain-lets-encrypt)):

```bash
sudo certbot certonly --webroot -w /var/www/certbot -d portal.yourschool.ng
sudo ln -s /etc/nginx/sites-available/nnss-portal /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

(Before the certificate exists nginx cannot load the config. Temporarily use a config with only the `listen 80` block to obtain it, or use `certbot --nginx`.)

### Windows: Caddy (automatic certificates)

Create `C:\nnss\Caddyfile`:

```
portal.yourschool.ng {
    reverse_proxy 127.0.0.1:5000
}
```

```powershell
nssm install Caddy "C:\Program Files\Caddy\caddy.exe" "run --config C:\nnss\Caddyfile"
nssm set Caddy Start SERVICE_AUTO_START
nssm set Caddy DependOnService NNSSPortal
nssm start Caddy
```

(`Get-Command caddy` shows its real path.) Caddy gets and renews the certificate itself. For a LAN-only name use `tls internal` and install Caddy's root certificate on each device.

### Check

```bash
curl -sI https://portal.yourschool.ng/api/health     # 200 and a Strict-Transport-Security header
curl -sI http://portal.yourschool.ng/                 # redirects to https
```

## 7. Firewall

Open **443 and 80 only**.

Linux:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Windows:

```powershell
New-NetFirewallRule -DisplayName "NNSS HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
New-NetFirewallRule -DisplayName "NNSS HTTP" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
```

Do not add rules for ports 5000 or 5432.

## 8. Backups

Set up the nightly database backup and test a restore **before** go-live: [OPERATIONS.md](OPERATIONS.md#backups-and-restore).

## 9. Go-live checklist

- [ ] `https://<name>/api/health` returns `{"status":"ok"}` and the log says `Database connection: OK`
- [ ] `http://<name>:5000` and port 5432 are **not** reachable from another computer
- [ ] Signed in as the Commandant and the administrator, then **changed both passwords**; `INITIAL_*_PASSWORD` lines removed from `.env`
- [ ] One test account per role signs in and sees only what it should
- [ ] A teacher saves a score, the HOD approves it, the student sees it
- [ ] The service survives a reboot of the server
- [ ] A backup was made **and restored** on another machine
- [ ] `.env` is not readable by other users and not in Git
- [ ] Demo/test data removed

Review [SECURITY.md](SECURITY.md) before real student data goes in.

## 10. Using Supabase from your own server

The portal does not care where the database is. To keep the portal on your server but the data on Supabase, set `DATABASE_URL` to the Supabase transaction-pooler string ([DEPLOY_VERCEL.md step 1](DEPLOY_VERCEL.md#1-supabase-database)) and skip the local PostgreSQL install. Pictures still go to the server's `frontend/uploads/` folder unless you set the `R2_*` settings.
