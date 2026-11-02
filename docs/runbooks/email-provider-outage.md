# Runbook: email provider outage

Status: **manual**. FR-A2, FR-A4, NFR-A2, NFR-A4. Provider: Resend (ADR-0005).

## What breaks and what does not

- **Breaks:** new users don't receive the verification email, and "resend verification"
  emails don't arrive.
- **Keeps working:** login, the library, saving links, account pages and the admin area.
  Verified users notice nothing.
- `/readyz` reports `"status": "degraded"` with `"email": "fail"` but stays **200**, so the API
  stays in rotation (OQ-44).
- Each email is tried 3 times with backoff (1 s, then 2 s), then dropped and logged
  (`email_send_failed`). There is no persistent queue. After an outage, people request a new
  link themselves.

Severity: usually **SEV3**. **SEV2** if it lasts more than 4 hours, or during a launch or
campaign when signups matter.

## Detect

- Alert: `event = "email_send_failed"` above the threshold, or `/readyz` email `fail` for
  10 minutes (`observability.md`).
- Users report "no verification email".

## Diagnose (15 minutes)

1. Check the Resend status page and the Resend dashboard's sending log.
2. Read the `reason` in the `email_send_failed` log lines:
   - `daily_quota_exceeded` / `monthly_quota_exceeded`: our plan limit, not an outage. Raise
     the plan or wait for the reset. These errors are not retried.
   - `validation_error` / `invalid_from_address`: our configuration. Check `EMAIL_FROM` and the
     domain's verification in Resend.
   - `missing_api_key` / `restricted_api_key`: the key was revoked or rotated badly. See
     `secret-rotation.md`.
   - `unknown`, 5xx, or timeouts: provider or network outage.
3. Check DNS: SPF, DKIM and DMARC records are still in place. A removed record shows as
   bounces or spam placement rather than send failures.

## Mitigate

- **Configuration or quota:** fix it, then send a verification to a test account to confirm.
- **Provider outage:** nothing to change in the app. Post a short notice if it lasts over an
  hour (`incident-communication.md`, "degraded service" template).
- **Outage longer than 24 hours:** suspend `linkpocket-cleanup` in Render. Otherwise accounts
  that signed up during the outage could be deleted as unverified after 7 days before their
  owners get a link (FR-A12). Resume it once email has worked for a day.
- **Outage longer than 2 days:** consider switching provider. That is a code change (a new
  `EmailTransport`) and needs an ADR. Not a runbook step.

## Recover

1. `/readyz` shows `"email": "ok"`. The email check is cached for 60 seconds.
2. A test signup on staging receives its email.
3. People affected use "Resend verification" (per account: 1 a minute, 5 an hour, FR-A4).
   If the outage was long, consider emailing affected signups (the count is in the logs; the
   addresses are in the database, not the logs).
4. Resume the cleanup job if it was suspended.
5. Close the incident and record its duration.
