# Security Policy

## Reporting a vulnerability

Please do not publish exploitable details in a public issue. Report suspected
security vulnerabilities privately through GitHub's security advisory reporting
feature for this repository, if available. Include the affected component,
impact, and steps to reproduce without accessing other people's data.

## Scope

This project handles school portal accounts, student records, grades, and OCR
score-sheet data. Treat these as sensitive information. Do not use production
student data in tests or upload it to third-party scanners without authorization.

## Automated checks

GitHub's default CodeQL setup and the repository CI workflow provide automated
checks. Scanner results are signals to investigate, not proof that the
application is secure.
