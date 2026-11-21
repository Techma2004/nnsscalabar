# Deploy online: Vercel + Supabase + Cloudflare R2

Do the steps in order. This is the setup that is live and working.

| Part | Service | Job |
|---|---|---|
| Website + API | Vercel | Hosts the portal |
| Database | Supabase (PostgreSQL) | Accounts, results, everything |
| Images | Cloudflare R2 | Blog/news pictures |
| Domain | Any registrar | Points your address at Vercel |

Score-sheet scanning (OCR) stays **off** online. Everything else works.

## 1. Supabase (database)

1. supabase.com -> New project, name `nnss-calabar`. Region: under **Europe** pick **West Europe (London)**; Ireland (`eu-west-1`) also works. Supabase has no Africa region. Save the database password.
2. Left sidebar -> **SQL Editor** -> New query. Paste all of `database/postgres/schema.sql` -> **Run** ("Success. No rows returned"). Safe to run twice.
3. Click **Connect** (top bar). Choose **Transaction pooler** (port **6543**). If you only see "Session pooler" (5432), copy it and change `:5432` to `:6543`. Never use the "Direct connection" string.
4. In the string, replace `[YOUR-PASSWORD]` with your password, **without the brackets**. Spaces and symbols must be encoded (space `%20`, `#` `%23`, `@` `%40`, `/` `%2F`, `!` `%21`). Easiest: use a password of letters and numbers only. To encode one:
   ```bash
   python3 -c "import urllib.parse as u,getpass;print(u.quote(getpass.getpass('Password: '),safe=''))"
   ```
   (Do not type a password inside a bash command: `!` triggers "event not found".)

## 2. Create the admin and commandant accounts (from your own computer, once)

```bash
git clone https://github.com/Techma2004/nnsscalabar
cd nnsscalabar/backend
npm install
cp .env.example .env
```

Edit `backend/.env`: set `DATABASE_URL` (in double quotes), `INITIAL_ADMIN_CODE`, `INITIAL_ADMIN_PASSWORD`, `INITIAL_COMMANDANT_CODE`, `INITIAL_COMMANDANT_PASSWORD`. Test the connection, then seed:

```bash
node -e "require('./db').query('select 1 as ok').then(([r])=>{console.log('connected',r);process.exit(0)}).catch(e=>{console.log('failed:',e.message);process.exit(1)})"
npm run seed:admin
npm run seed:commandant
```

Generate and save a JWT secret into `.env` (also paste it into Vercel in step 4):

```bash
S=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))") && (grep -q '^JWT_SECRET=' .env && sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$S|" .env || echo "JWT_SECRET=$S" >> .env) && echo "$S"
```

## 3. Cloudflare R2 (images) — optional until you need news pictures

1. R2 -> create a bucket (e.g. `nnss-files`). Enable public access (the `r2.dev` URL, or a custom domain). That URL is `R2_PUBLIC_URL`.
2. R2 -> Manage API tokens -> token with **Object Read & Write** for this bucket. Copy the Access Key ID and Secret.
3. Copy your Cloudflare **Account ID**.

## 4. Vercel

1. vercel.com -> Add New -> Project -> import the GitHub repo (`main` branch).
2. **Root Directory:** `./`. **Application Preset:** `Other`. (`vercel.json` in the repo sets the rest.)
3. **Settings -> General -> Node.js Version:** `22.x`.
4. **Settings -> Environment Variables** (Production). Add only these:

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | the encoded pooler string, **no quotes** |
| `JWT_SECRET` | the secret from step 2 |
| `COOKIE_SECURE` | `true` |
| `AI_SCORE_IMPORT_ENABLED` | `false` |
| `FRONTEND_ORIGIN` | your domain, once attached (optional before) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` | from step 3 (when ready) |

   **Do not add:** `PORT`, `HOST`, `DB_POOL_SIZE`, `TRUST_PROXY_HOPS` (leave unset; it is `1` on Vercel automatically), `OCR_*`, `INITIAL_*`. **Never leave a variable blank**: delete it instead.
5. Deploy. Function region is set in `vercel.json` (`dub1` = Dublin, matching a Supabase Ireland project; use `lhr1` for a London project).

## 5. Custom domain (live: https://nnsscalabar.dpdns.org)

1. Register the domain (any registrar; free `dpdns.org` names work too).
2. Vercel -> Settings -> **Domains** -> add `nnsscalabar.dpdns.org`. Vercel lists the records to add.
3. At the DNS provider add the records Vercel shows. Copy the exact values from Vercel:

| Type | Name | Value |
|---|---|---|
| TXT | `_vercel` | `vc-domain-verify=...` (only if Vercel says the domain is linked to another account; delete it afterwards) |
| A | `@` | the IP Vercel shows (often `76.76.21.21`) |
| CNAME | `www` | the `...vercel-dns.com` address Vercel shows |

4. Click **Refresh** in Vercel until the tick is green. HTTPS is automatic.
5. **Required:** add the environment variable `FRONTEND_ORIGIN=https://nnsscalabar.dpdns.org` (exact origin, no trailing slash; several origins separated by commas) and **Redeploy**. Without it every login fails with **"Request not allowed."**
6. `vercel.json` already redirects `www.nnsscalabar.dpdns.org` (permanent) and `nnsscalabar.vercel.app` (temporary) to the main domain. If the domain ever changes, edit the two `redirects` entries, `frontend/robots.txt` and `frontend/sitemap.xml`.

### Google Search Console

1. search.google.com/search-console -> Add property -> **Domain** -> `nnsscalabar.dpdns.org`.
2. Add the TXT record Google shows (name `@`, value `google-site-verification=...`) at the DNS provider, then **Verify**. If the DNS panel cannot take it, use **URL prefix** with the HTML tag method and add the tag to `frontend/index.html`.
3. Sitemaps -> submit `sitemap.xml`. It lists the home, about, blog and newsletter pages. `robots.txt` blocks `/portal`, `/login` and `/api/`, and those two pages also send `X-Robots-Tag: noindex`.

## 6. Check it works

1. `https://<your-site>/api/health` shows `{"status":"ok"}`.
2. Log in as `ADM001`, then as `CMD001`. Change both passwords.
3. Create a news post with an image (needs R2).

## Optional: Vercel Web Analytics

Enable **Analytics** in the Vercel project. The public pages already carry the plain-HTML tag `<script defer src="/_vercel/insights/script.js"></script>`; no npm package is needed (the `@vercel/analytics/next` import is for Next.js only).

## Problems we hit, and the fixes

| What you see | Cause | Fix |
|---|---|---|
| Vercel shows "Multiple applications detected" and asks for a `vercel.json` | Imported a branch that lacked the Vercel config | Merge the work into `main`, re-import, preset **Other**, root `./` |
| `500 FUNCTION_INVOCATION_FAILED`, log says `Cannot find module 'dotenv'` | Packages were installed in `backend/` only | Fixed: the repo root `package.json` lists the runtime packages. **Keep it in sync with `backend/package.json`** |
| Login says "The page could not be found" | Vercel's catch-all file name did not match `/api/auth/login` | Fixed: one function `api/index.js` plus a rewrite in `vercel.json` |
| Every request 500, log says `TRUST_PROXY_HOPS must be an integer from 0 to 10` | The variable was blank in Vercel | Fixed in code (blank = unset). Still: delete blank variables |
| Login shows `[object Object]` | Vercel's own error is an object | Fixed: the page now prints the real message |
| Password with `! # @` fails or bash says "event not found" | Special characters in the URL / shell history expansion | Encode the password (step 1), or use letters and numbers only |
| Connect dialog has no "Transaction pooler" | Supabase labels differ | Take the Session pooler string and change the port to `6543` |
| Login shows "Request not allowed." on the new domain | The domain is not in the allow-list | Set `FRONTEND_ORIGIN` to the exact `https://` domain and redeploy (step 5) |
| Login button stuck on "Signing in…" after pressing Back from the portal | Browser restored the login page frozen | Fixed: sign-in replaces the login page in history and the page resets itself |

## Limits to know

- Uploads pass through Vercel: max **4.5 MB** per request; the portal caps images at 2.5 MB. Bigger files need direct-to-R2 uploads.
- OCR is off online. Teachers use the Excel template import. Later options: a small Docker service (Render, Railway, Fly.io), a VPS, or the school PC.
- Use the **pooler** URL (6543), not the direct one.
- Sessions last 8 hours or until sign out.

## Running the same code on a school PC instead

Install PostgreSQL, create a database, run `database/postgres/schema.sql`, and set `DATABASE_URL=postgres://nnss_user:password@127.0.0.1:5432/nnss_calabar`. Nothing else changes. Set `AI_SCORE_IMPORT_ENABLED=true` there to use OCR.

## Before real data

Reset the database password and `JWT_SECRET` if they were ever pasted anywhere shared, and change the admin and commandant passwords after first login.
