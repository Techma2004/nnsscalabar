# Vercel / Supabase / Cloudflare R2 deployment status

Branch: `deploy/vercel-supabase-r2`

This document is intentionally explicit about what is and is not deployable. **This branch is not production-ready. Do not attach the live school domain or enter real student records yet.**

## Current repository state

The branch now has an initial Vercel Express adapter (`api/index.js`) and `vercel.json` routing. The Vercel function bundles the existing `frontend/**` files so the current Express static middleware can read them. The root runtime package manifest and local startup path remain in place. This is deployment plumbing only; it does not make the application compatible with Supabase or durable object storage.

The application is still MySQL-specific:

- `backend/db.js` imports `mysql2` and reads `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME`.
- The routes expect mysql2 result shapes such as `[rows]`, `insertId`, and `affectedRows`.
- SQL throughout the application uses MySQL syntax and semantics, including `DATE_FORMAT`, `FIND_IN_SET`, `NOW()`, boolean arithmetic, and MySQL upsert/transaction patterns.
- `database/schema.sql` is a MySQL schema. It is not a PostgreSQL migration.
- News images are currently written to `frontend/uploads/` on the local filesystem. That storage is not durable on Vercel.
- The server currently uses `express.static(FRONTEND_DIR)`. The Vercel function currently includes `frontend/**` as a compatibility bridge; static assets have not yet been separated into Vercel's static output. Verify every page and nested asset on a preview, and consider moving public assets to root `public/` as a later optimization.
- Score-sheet and image upload endpoints accept base64 JSON. Vercel Function request and response bodies are limited to 4.5 MB, so file uploads must be redesigned to upload directly from the browser to object storage.
- OCR must remain disabled for the first hosted release.

A successful Vercel build or deployment URL would therefore **not** mean that sign-in, results, uploads, or school administration work.

## Required implementation gates

Do not mark this deployment ready until every gate below is complete and tested.

1. **PostgreSQL schema**
   - Create a PostgreSQL schema that faithfully represents all existing MySQL tables, indexes, constraints, generated values, defaults, and views.
   - Preserve identifiers and foreign-key relationships so existing records can be migrated without changing their meaning.
   - Keep the MySQL schema and database untouched as the rollback source.

2. **PostgreSQL data access**
   - Replace mysql2 with a PostgreSQL driver and a single database adapter that supports both local PostgreSQL and Supabase PostgreSQL through `DATABASE_URL`.
   - Convert every SQL call site; do not attempt a global placeholder replacement.
   - Rewrite MySQL-only expressions, insert ID handling (`RETURNING`), upserts, date functions, boolean expressions, and transactions.
   - Test transaction boundaries and concurrent requests. For Vercel, use Supabase's transaction pooler, a small per-instance pool, disabled prepared statements, and TLS as required by the selected driver.

3. **Cloudflare R2**
   - Add server-authorized upload intents and browser-to-R2 uploads. The file bytes must not pass through a Vercel Function.
   - Validate allowed file types, actual file signatures, size, ownership, and destination keys.
   - Store object keys (not expiring signed URLs) in PostgreSQL.
   - Keep private student documents private; only issue short-lived download URLs after authorization.
   - Add cleanup for abandoned uploads and deleted records.

4. **Frontend and Vercel routing**
   - Initial Vercel routing now exists in `vercel.json`; `api/index.js` exports the existing Express application and `frontend/**` is bundled with the function.
   - Verify all API paths, page routes, nested assets, cache headers, and asset URLs on a preview deployment.
   - Decide whether to keep the bundled Express static compatibility bridge or move public assets into root `public/` after preview verification. Do not remove either path until all existing pages and assets are confirmed.

5. **Production security**
   - Configure secure cookies, trusted proxy handling, strict allowed origins, and shared rate limiting where multiple function instances require it.
   - Keep all database and R2 credentials in Vercel environment variables; never put secrets in browser code or Git.
   - Disable OCR using `AI_SCORE_IMPORT_ENABLED=false`.
   - Ensure backups, restore procedures, logging, and access controls are in place.

6. **Regression and migration verification**
   - Run unit, API, and browser tests against disposable PostgreSQL data.
   - Test login and permissions for every role, student records, teacher assignments, result entry, HOD approval/rejection, published results, announcements, posts, Excel import, and file authorization.
   - Compare row counts and foreign-key integrity after a synthetic-data migration.
   - Verify representative report cards and grading calculations.
   - Do not migrate real school records until the synthetic migration and restore test pass.

## Vercel project setup (after all application gates pass)

The repository now contains the initial Vercel routing adapter, but the application is **not ready for a functional hosted deployment** while the database remains MySQL-specific and uploads depend on local disk. Do not configure production traffic or real records yet.

1. Import `Techma2004/nnsscalabar` into Vercel.
2. Select branch `deploy/vercel-supabase-r2` for a preview deployment. A merge to `main` is not required to deploy a branch preview.
3. Use the repository root as the project root. Do not set the root directory to `backend`.
4. Use the Node.js runtime supported by the project's `engines` field.
5. Add environment variables only after the PostgreSQL and R2 adapters are implemented and their names are finalized. Do not add the old MySQL variables as a substitute for the PostgreSQL configuration.
6. Deploy a preview and run the full synthetic-data smoke test before assigning any production domain.
7. Keep the live domain pointed at the existing known-good portal until the new deployment passes the acceptance checklist.

## Environment configuration expected by the finished architecture

The final application should use a PostgreSQL `DATABASE_URL` and server-only R2 credentials. The exact R2 variable names must match the implemented storage adapter; do not guess them or paste credentials into source files.

OCR setting for the initial hosted release:

```dotenv
AI_SCORE_IMPORT_ENABLED=false
```

Use Supabase's transaction-mode pooler for Vercel/serverless PostgreSQL connections. Configure the chosen driver for the pooler's transaction-mode limitations, including prepared statements and connection pool sizing.

## Cutover and rollback

1. Take a verified backup of the existing MySQL database and test that it can be restored.
2. Freeze writes to the old portal during the final migration window.
3. Migrate into the PostgreSQL database; retain the original MySQL database read-only and unchanged.
4. Run row-count, relationship, role, grading, and report-card checks.
5. Point the preview environment at synthetic data and complete the full acceptance suite.
6. Only after approval, set the production environment variables and promote the tested deployment.
7. If any acceptance check fails, route users back to the existing portal and preserve both database copies for investigation.

## Official platform references

- [Express on Vercel](https://vercel.com/docs/frameworks/backend/express) — Express deployment and static assets under `public/`.
- [Vercel Function limits](https://vercel.com/docs/functions/limitations) — request/response body limit.
- [Supabase: connect to PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres) — choose the connection mode for the runtime.
- [Supabase: serverless drivers](https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers) — transaction pooler and serverless driver configuration.
- [Cloudflare R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/) — S3-compatible object-storage API.
