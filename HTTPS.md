# HTTPS for the NNSS Calabar portal

The portal speaks plain HTTP on `127.0.0.1:5000`. Anything that crosses a school network (passwords, session cookies, results) must be wrapped in TLS. The way to do that is a reverse proxy in front of Node. TLS is **opt-in**: LAN-HTTP development (`npm start`, `http://localhost:5000`) keeps working unchanged.

Windows Server uses Caddy instead of nginx: follow [WINDOWS_SERVER.md](WINDOWS_SERVER.md) section 7. This page is the Linux/nginx route.

> The nginx file and the commands here have **not been run on a live school server**. Test on a spare machine first.

## 1. Application settings

In `backend/.env`:

```ini
NODE_ENV=production
HOST=127.0.0.1
TRUST_PROXY_HOPS=1
COOKIE_SECURE=true
FRONTEND_ORIGIN=https://portal.school.lan
```

- `COOKIE_SECURE=true` makes the session cookie HTTPS-only (it is already the default when `NODE_ENV=production`; set it explicitly so the intent is visible). Over plain HTTP the browser then refuses the cookie and sign-in appears to log you out at once.
- `HSTS` (`Strict-Transport-Security`) is sent by the app **only in production**, so a development server is never pinned to HTTPS.
- `TRUST_PROXY_HOPS=1` for exactly one proxy (nginx). Never set more than the number of proxies you run.
- `FRONTEND_ORIGIN` must equal the address users type, scheme included.

## 2. LAN with no public domain: your own certificate authority

Run on the server (needs `openssl`). Keep `school-ca.key` offline and private.

```bash
mkdir -p ~/nnss-ca && cd ~/nnss-ca && umask 077

# 1) The school's root CA (valid 5 years)
openssl genrsa -out school-ca.key 4096
openssl req -x509 -new -key school-ca.key -sha256 -days 1825 \
  -subj "/CN=NNSS Calabar School CA" -out school-ca.crt

# 2) The portal certificate (valid 1 year; the name MUST match what users type)
openssl genrsa -out portal.key 2048
openssl req -new -key portal.key -subj "/CN=portal.school.lan" -out portal.csr
printf "subjectAltName=DNS:portal.school.lan,IP:192.168.1.10\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n" > san.ext
openssl x509 -req -in portal.csr -CA school-ca.crt -CAkey school-ca.key -CAcreateserial \
  -sha256 -days 365 -extfile san.ext -out portal.crt

# 3) Install for nginx
sudo mkdir -p /etc/nginx/tls
sudo sh -c 'cat portal.crt school-ca.crt > /etc/nginx/tls/portal.school.lan.fullchain.pem'
sudo install -m 600 portal.key /etc/nginx/tls/portal.school.lan.key
```

Replace `portal.school.lan` and `192.168.1.10` with your real name and the server's LAN address, and make sure your router or DNS resolves the name to that address.

Then install the proxy config and reload:

```bash
sudo cp deploy/nginx/nnss-portal.conf /etc/nginx/conf.d/nnss-portal.conf
sudo nginx -t && sudo systemctl reload nginx
```

### Installing the CA on school devices

Give each device **`school-ca.crt` only** (never a `.key`), and install it as a trusted root:

| Device | How |
|---|---|
| Windows PC | double-click `school-ca.crt` → Install Certificate → Local Machine → "Trusted Root Certification Authorities". A domain can push it by Group Policy. |
| Android | Settings → Security → Encryption & credentials → Install a certificate → CA certificate |
| iPhone/iPad | open the file, install the profile, then Settings → General → About → Certificate Trust Settings → enable it |
| Linux | copy to `/usr/local/share/ca-certificates/` and run `sudo update-ca-certificates` (Firefox keeps its own store) |

Renew `portal.crt` before it expires (the CA lasts longer, so devices do not need updating again).

## 3. Public domain: Let's Encrypt

If the portal has a real public name pointing at the server and ports 80/443 are reachable:

```bash
sudo apt install certbot
sudo certbot certonly --webroot -w /var/www/certbot -d portal.yourschool.ng
```

Point `ssl_certificate` / `ssl_certificate_key` in `nnss-portal.conf` at `/etc/letsencrypt/live/portal.yourschool.ng/fullchain.pem` and `privkey.pem`. Certbot's timer renews automatically; add `--deploy-hook "systemctl reload nginx"` so nginx picks up the new certificate.

## 4. Check it

```bash
curl -sI https://portal.school.lan/api/health     # 200, and a Strict-Transport-Security header
curl -sI http://portal.school.lan/                 # 301 to https
curl -m 3 http://<server-lan-address>:5000/        # must FAIL: Node listens on loopback only
```

## 5. Caveat on a hostile LAN

The app automatically trusts `http://<every LAN address of the server>:5000` as an allowed origin (`getAllowedOrigins()` in `backend/server.js`) so that LAN-HTTP development works. Cross-site request forgery is still blocked by `SameSite` cookies and the Origin check, and with `HOST=127.0.0.1` behind the proxy nothing listens on those addresses, so the extra origins are inert. But HTTPS does **not** protect against a malicious device that already sits on your network and can intercept or spoof traffic before users have the school CA installed. On a network you do not control (students' devices on the same Wi-Fi), put the portal on a separate VLAN, keep ports 5000/3306 firewalled, and use the public-domain option in section 3 so no device has to trust a private CA.
