# Runbook: external penetration test

Status: **manual, before public launch** (NFR-S18, AC-24). Critical and high findings are fixed
before release.

## Arrange

- [ ] Choose an independent tester with web application experience (OWASP ASVS Level 2).
- [ ] Agree scope, dates, source IPs and a contact for emergencies, in writing.
- [ ] Target: **staging** with production-equivalent configuration (helmet, CSP, rate limits
      at default, `RATE_LIMIT_MULTIPLIER=1`). Synthetic data only.
- [ ] Provide test accounts: two verified users (to test cross-user access), one unverified
      user, one admin. Share the passwords through a password manager, never email.

## Scope

- Web app: every page under `/` and `/admin`, including CSP, cookies and clickjacking.
- API `/api/v1/*` (SRS 6), especially:
  - authentication: signup, verify, login, logout, lockout, change password;
  - sessions and CSRF;
  - access control: other users' resources (AC-8), admin endpoints as a user (AC-10);
  - input validation: NoSQL operators, size limits, URL schemes (AC-9);
  - user enumeration (AC-14);
  - export and delete;
  - admin re-authentication.
- `/healthz` and `/readyz` (information disclosure).
- Out of scope: Render, Vercel, Atlas and Resend infrastructure; denial of service.

## Afterwards

- [ ] Each finding becomes an issue with severity. Critical and high are fixed and retested
      by the tester before launch.
- [ ] Medium and low get a decision (fix date or accepted risk) recorded in
      `docs/OPEN-QUESTIONS.md`.
- [ ] Store the report where only the team can read it, and note its date and result in
      `docs/TRACEABILITY.md` (AC-24).
- [ ] Rotate the test accounts' passwords, or delete the accounts.
