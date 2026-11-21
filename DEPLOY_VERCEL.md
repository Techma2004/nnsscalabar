# Deploy online: Vercel + Supabase + Cloudflare R2

Do the steps in order. Total time: about 45 minutes.

| Part | Service | Job |
|---|---|---|
| Website + API | Vercel | Hosts the portal |
| Database | Supabase (Postgres) | Accounts, results, everything |
| Images | Cloudflare R2 | Blog/news pictures |
| Domain | Any registrar | Points your address at Vercel |

The score-sheet scanner (OCR) stays **off** online. Everything else works.

## 1. Supabase (database)

1. supabase.com -> New project. Name `nnss-calabar`. Region: **London (eu-west-2)** (closest available to Nigeria). Save the database password.
2. Open **SQL Editor** -> New query.
3. Paste the whole content of `database/postgres/schema.sql` -> **Run**. It is safe to run twice.
4. Click **Connect** (top bar) -> **Transaction pooler**. Copy the string (port **6543**). Put your password in place of `[YOUR-PASSWORD]`. This is your `DATABASE_URL`.

## 2. Cloudflare R2 (images)

1. Cloudflare dashboard -> R2 -> Create bucket `nnss-files`.
2. Bucket -> Settings -> **Public access**: enable the `r2.dev` URL (or connect a custom domain such as `files.yourschool.edu.ng`). Copy that URL: it is `R2_PUBLIC_URL`.
3. R2 overview -> **Manage API tokens** -> Create token, permission **Object Read & Write**, only for this bucket. Copy the Access Key ID and Secret.
4. Copy your **Account ID** (right side of the R2 overview page).

## 3. Create the first admin (from your own computer, once)

```bash
cd backend
cp .env.example .env
```

In `backend/.env` set only: `DATABASE_URL` (from step 1), `JWT_SECRET`, `INITIAL_ADMIN_CODE`, `INITIAL_ADMIN_PASSWORD`. Then:

```bash
npm install
npm run seed:admin
npm run seed:commandant
```

(Optional) load the class rosters: `node ../database/import-rosters.js`.

## 4. Vercel

1. vercel.com -> Add New -> Project -> import the GitHub repo.
2. Leave Root Directory as the repo root. `vercel.json` already sets everything else.
3. **Settings -> Functions -> Function Region: London (lhr1)**. This must match Supabase.
4. **Settings -> Environment Variables** (Production), add:

| Name | Value |
|---|---|
| `DATABASE_URL` | pooler string from step 1 |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `NODE_ENV` | `production` |
| `FRONTEND_ORIGIN` | your domain, e.g. `https://portal.yourschool.edu.ng` |
| `R2_ACCOUNT_ID` | step 2 |
| `R2_ACCESS_KEY_ID` | step 2 |
| `R2_SECRET_ACCESS_KEY` | step 2 |
| `R2_BUCKET` | `nnss-files` |
| `R2_PUBLIC_URL` | step 2, no trailing slash |

5. Deploy.

## 5. Domain

1. Buy the domain at any registrar (Namecheap, Cloudflare, Qservers for `.ng`).
2. Vercel -> Project -> Settings -> **Domains** -> add it. Vercel shows the DNS records. Add them at the registrar.
3. Wait for the green tick (minutes to a few hours). HTTPS is automatic.
4. Put the final address in `FRONTEND_ORIGIN`, then **Redeploy**.

## 6. Check it works

1. Open `https://<your-domain>/api/health` -> `{"status":"ok"}`.
2. Log in with the admin code from step 3.
3. Create a news post with an image -> the image must appear.
4. Change the admin password.

## Limits to know

- Uploads go through Vercel: max **4.5 MB** per request. The portal caps images at 2.5 MB. Bigger files would need direct-to-R2 uploads.
- Score-sheet OCR is off. Teachers use the Excel template import instead.
- Use the **pooler** URL (port 6543), not the direct one, or you will run out of connections.

## Running the same code on a school PC instead

Install PostgreSQL, create a database, run `database/postgres/schema.sql` on it, and set:

```
DATABASE_URL=postgres://nnss_user:password@127.0.0.1:5432/nnss_calabar
```

Nothing else changes. Set `AI_SCORE_IMPORT_ENABLED=true` there to use OCR.

## Later: bringing OCR back

Vercel cannot run Tesseract. Options: a small Docker service on Render, Railway or Fly.io; a cheap VPS; or the school PC. The portal calls it only when `AI_SCORE_IMPORT_ENABLED=true`.
