# Vercel + Supabase + Cloudflare R2 setup

This guide describes the target hosted environment for the NNSS Calabar portal. **Do not use it for a live school deployment until the PostgreSQL and R2 application migration is complete and the acceptance checklist in `VERCEL_DEPLOYMENT_STATUS.md` passes.** The current application still contains MySQL queries and local-filesystem upload paths; adding these dashboard settings alone will not make those features work.

Use a separate Vercel Preview deployment and synthetic data first. Do not point the live school domain at this branch during migration.

## 1. Supabase PostgreSQL

1. Create a new Supabase project for the portal. Keep the existing MySQL database separate and unchanged.
2. Save the database password in a password manager. Do not commit it or paste it into source files.
3. Open **Project Settings → Database → Connection string**.
4. For Vercel/serverless, choose the **Transaction pooler** connection string. Supabase commonly exposes this on port `6543`; copy the exact host, username, port and database from the dashboard rather than constructing them manually.
5. Use the pooler URL for the Vercel Preview environment. Use a direct connection or local PostgreSQL URL for migration administration and local development where appropriate.
6. Require TLS. If the selected driver requires an explicit SSL option, configure it in the application rather than disabling certificate checks.
7. Do not import the existing MySQL schema directly into Supabase. MySQL DDL and migration files are not PostgreSQL-compatible. Wait for the checked-in PostgreSQL schema/migration to be completed and reviewed.

The application target is a single `DATABASE_URL` setting, so local PostgreSQL and Supabase use the same schema and query code. Never set both old `DB_HOST/DB_USER/DB_PASSWORD/DB_NAME` variables and a new `DATABASE_URL` and expect the application to choose safely.

## 2. Cloudflare R2

1. In Cloudflare, open **R2 Object Storage** and create a bucket dedicated to the portal, for example `nnss-calabar-uploads`.
2. Keep the bucket private by default. Student documents and result sheets must not be exposed through a public bucket URL.
3. Create an R2 API token scoped only to this bucket, with the minimum object read/write permissions needed by the application.
4. Record the account ID, access key ID and secret access key securely. The secret is shown only when created.
5. The S3-compatible endpoint format is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`; use region `auto` in S3-compatible clients.
6. Do not put R2 credentials in frontend JavaScript, HTML, or any variable prefixed with `NEXT_PUBLIC_` or `VITE_`.
7. The intended upload design is: authenticated API issues a short-lived presigned upload URL; browser uploads bytes directly to R2; API validates and records the object key; authorized downloads use short-lived presigned GET URLs. Do not proxy large file bodies through a Vercel Function.
8. Do not use a public bucket or public custom domain for private student files. Public blog imagery, if needed, should use a separate explicitly public policy and must not share the private-document path.

The application adapter is expected to use these server-only environment variable names once the R2 implementation is merged:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_BASE_URL` (optional; only for content explicitly approved as public)

These names are the target configuration contract, not a claim that the current branch already implements R2 uploads.

## 3. Vercel project

After the code migration is complete:

1. Import `Techma2004/nnsscalabar` into Vercel.
2. Select branch `deploy/vercel-supabase-r2` for a Preview deployment. **A pull request does not need to be merged into `main` to deploy a branch preview.**
3. Set the project Root Directory to the repository root (`.`), not `backend`.
4. Use the Node.js runtime supported by the repository's `engines` field.
5. Keep the existing Express/Vercel entry point and routing configuration from the branch. Do not add a second competing rewrite.
6. Add the environment variables below to **Preview** first. Do not add production secrets until preview testing passes.
7. Deploy and run the synthetic-data acceptance checklist. A green build only proves the code compiled; it does not prove login, database writes, result approval or file access works.

### Preview environment variables

The finished application is intended to use:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase Transaction Pooler connection URI |
| `JWT_SECRET` | Unique random secret, at least 32 characters |
| `FRONTEND_ORIGIN` | Exact HTTPS origin of the Vercel preview |
| `TRUST_PROXY_HOPS` | `1` only if verified for the deployed proxy topology |
| `COOKIE_SECURE` | `true` |
| `AI_SCORE_IMPORT_ENABLED` | `false` for the first hosted release |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | Bucket-scoped R2 access key ID |
| `R2_SECRET_ACCESS_KEY` | Bucket-scoped R2 secret |
| `R2_BUCKET_NAME` | Private portal bucket name |
| `R2_PUBLIC_BASE_URL` | Omit unless a separate public-asset policy is implemented |

Do not copy the placeholder values above into Vercel. Generate the JWT secret locally with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Add the variables to Vercel → Project → Settings → Environment Variables, selecting **Preview**. Redeploy after changing environment variables.

## 4. Custom domain

Do this only after the Preview acceptance tests pass and the school approves cutover:

1. Add the domain in Vercel → Project → Settings → Domains.
2. Follow the exact DNS records Vercel displays at the domain registrar. Do not guess A, CNAME or TXT values.
3. Verify the domain in Vercel and wait for HTTPS provisioning.
4. Update `FRONTEND_ORIGIN` to the exact production origin (scheme included, no trailing slash).
5. Add production environment variables separately; never copy Preview credentials blindly.
6. Keep the old portal and MySQL database available for rollback until the agreed observation period has passed.

## 5. Local PostgreSQL development

The target local setup uses the same PostgreSQL schema and `DATABASE_URL` as Supabase:

```dotenv
DATABASE_URL=postgresql://portal_user:URL_ENCODED_PASSWORD@127.0.0.1:5432/nnss_calabar
JWT_SECRET=replace-with-a-unique-random-secret
NODE_ENV=development
AI_SCORE_IMPORT_ENABLED=false
```

URL-encode reserved characters in the database password. Never commit a real `.env` file. Use synthetic records only while validating the migration.

## 6. Cutover and rollback rules

- Back up the existing MySQL database and verify that the backup can be restored.
- Migrate a copy into PostgreSQL; compare every table's row count and check foreign keys.
- Test every role (student, teacher, HOD, admin, commandant and editor), result entry, approval/rejection, report cards, Excel import, announcements and upload authorization.
- Test private R2 downloads with an unauthorized user and confirm access is denied.
- Keep the original MySQL database read-only and untouched during the pilot.
- If any acceptance test fails, keep the existing portal serving users. Do not attempt a rushed production cutover.

## Official documentation

- Vercel Express deployment: https://vercel.com/docs/frameworks/backend/express
- Vercel Functions limits: https://vercel.com/docs/functions/limitations
- Supabase PostgreSQL connections: https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase connection pooling: https://supabase.com/docs/guides/database/connecting-to-postgres#connection-pooler
- Cloudflare R2 S3 API: https://developers.cloudflare.com/r2/api/s3/api/
- Cloudflare R2 presigned URLs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
