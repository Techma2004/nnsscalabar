# Security Policy

The NNSS Calabar School Management System handles account credentials and may handle sensitive student, staff, and academic information. Treat security reports and operational data with care.

## Supported version

Security fixes and review currently target the latest code on the repository's default branch, `main`. If you run an older commit or a modified deployment, update/compare against the current source before assuming that a fix is present. No formal long-term-support or patch schedule is promised.

## Report a vulnerability privately

**Do not publish exploitable security details, credentials, student information, session cookies, database dumps, or proof-of-concept data in a public GitHub issue or pull request.**

1. Check whether GitHub's **Report a vulnerability** / private vulnerability reporting option is enabled for this repository. If it is available, use it to submit the report privately.
2. If private reporting is unavailable, contact the repository owner/maintainer through the contact method available on the [Techma2004 GitHub profile](https://github.com/Techma2004). Ask for a private security-reporting channel; do not include sensitive details in a public post.
3. Include a concise description, affected path/endpoint or commit, impact, prerequisites, and safe reproduction steps. Redact real identities, passwords, tokens, cookies, and school records.
4. Allow the maintainer time to investigate and prepare a fix before public disclosure. Please do not access, alter, or download data that is not yours while validating a suspected issue.

A report is not a guarantee of a particular response time, bounty, or coordinated-disclosure schedule. The maintainer should acknowledge receipt when practical and may request additional non-sensitive details.

If real student/staff data may already be exposed, notify the school's authorized system administrator immediately through the school's internal incident process as well as reporting the software vulnerability.

## Security controls in the current codebase

The application includes several controls intended to reduce common risks. These controls are not a guarantee that every deployment is secure.

- **Authentication:** signed JWTs in HTTP-only cookies, bcrypt password hashing, account active-state checks, token/session-version validation, and an eight-hour token lifetime.
- **Login protection:** rate limiting by account/IP and request ceilings for API routes. Current rate-limit storage is in memory and is intended for a single backend process; use a shared store before scaling horizontally.
- **Authorization:** backend routes enforce roles, student ownership, departmental scope, and teacher class/arm/subject assignments. Hiding a menu item in the browser is not the security boundary.
- **Input and database safety:** parameterized SQL queries and input validation are used in application routes.
- **Browser protections:** Content Security Policy, security headers, restricted CORS origins, origin/Sec-Fetch-Site checks for state-changing requests, and `Cache-Control: no-store` on API responses.
- **Request limits:** bounded JSON payloads and route-specific rate limits; OCR upload handling uses temporary storage and a timeout.
- **Result workflow:** scores are validated against configured component limits; OCR output requires teacher review; HOD approval controls student visibility; edits to approved results reset approval and are logged.
- **Operational checks:** `GET /api/health` reports API/database connectivity, and `cd backend && npm test` runs the current backend test suite.

Security behavior can change as the repository evolves. Review the current implementation and tests rather than relying solely on this summary.

## Required deployment precautions

1. **Use HTTPS for real data.** Never serve real student/staff records over plain HTTP, including over private Wi-Fi/LAN. Configure HTTPS and set `COOKIE_SECURE=true`.
2. **Use real secrets.** Set a unique random `JWT_SECRET` of at least 32 characters and a unique database password. The server rejects known placeholders, but operators must still protect valid secrets.
3. **Keep secrets out of source control.** Never commit `backend/.env`, credentials, tokens, imported-credential files, database backups, or real school data. Rotate any secret that was exposed.
4. **Use least privilege.** The app must connect with a dedicated MySQL/MariaDB user scoped to the application database, not the database root account. Restrict database network access.
5. **Bind conservatively.** Keep `HOST=127.0.0.1` for local-only use. Use `0.0.0.0` only when LAN access is intentional and firewall rules are restricted to trusted networks.
6. **Configure reverse proxies carefully.** Keep `TRUST_PROXY_HOPS=0` for direct access. Behind a trusted proxy, set the exact verified hop count (0–10); never use unrestricted proxy trust. The proxy must overwrite untrusted forwarded headers.
7. **Back up and test restoration.** Back up the database before migrations or imports, protect backup files, and periodically test restoring to a controlled environment.
8. **Protect bootstrap credentials.** Create the initial Commandant/Admin deliberately, remove or replace bootstrap password values after use, and deliver credentials privately.
9. **Use verified school data.** Replace sample/demo records before production. Review user roles, student lifecycle state, curriculum, teacher assignments, academic session, and terms.
10. **Review scaling assumptions.** The built-in in-memory rate limiters do not coordinate across multiple application instances. Use a shared store and review proxy/network behavior before horizontal scaling.
11. **Keep dependencies and CI current.** Review dependency/security alerts, CI workflows, and changes to authentication, authorization, SQL, OCR, and session handling.
12. **Treat OCR as untrusted input.** Confirm each extracted student and score against the official source before submission. OCR does not approve or publish results automatically.

## Security testing and maintenance

Run the targeted backend tests from the repository root:

```bash
cd backend
npm test
```

These tests provide useful regression coverage but are not a substitute for a production configuration review, dependency review, manual authorization checks, or database backup/restore test. Avoid broad testing against live school data without authorization and a controlled plan.

Changes to authentication, permissions, database queries, uploads/OCR, cookies, proxy settings, or result publication should include focused tests and corresponding documentation updates. Do not suppress or dismiss a security finding merely to make a dashboard green; document the rationale and verify the affected code path.

## Data handling

- Only authorized school personnel should access personal and academic records.
- Use synthetic data for development and plain-HTTP demonstrations.
- Redact identifiers and personal data from logs, support requests, and bug reports.
- Do not attach student data to public issues, CI artifacts, screenshots, or example fixtures.
- Follow the school's applicable retention, access, and incident-response requirements.
