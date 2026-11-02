# ADR-0005: Email verification tokens, resend limits and email delivery

- **Status:** Accepted
- **Date:** 2026-11-01
- **Deciders:** Product and Engineering
- **Requirements:** FR-A2, FR-A4, FR-A5, FR-A12, NFR-S9, NFR-S15, NFR-A4, NFR-A5

## Context

Phase 4 adds email verification. Signup sends a single-use link valid for 24 hours (FR-A2).
Resends are limited per account (FR-A4). A valid link verifies the account and starts a
session (FR-A5). Tokens are stored only as hashes (NFR-S9). Signup and resend must answer the
same way for every address (NFR-S15). Email failures are retried (NFR-A4). Unverified
accounts are deleted after 7 days by an idempotent job (FR-A12, NFR-A5).

## Decision

1. **Tokens:** 32 random bytes, base64url (43 characters). The user record stores only the
   SHA-256 (`emailVerificationTokenHash`) and the expiry. Each account has at most one live
   token, and a new send replaces it, so only the newest link works. Verifying is one atomic
   `findOneAndUpdate` on the hash that also clears it, so a link cannot be used twice even
   by concurrent requests. A partial unique index on the hash (migration 0006) keeps the
   lookup fast.
2. **Comparison (NFR-S9):** the token is never compared in application code. The database
   looks up its SHA-256, and a timing difference in that lookup reveals at most something
   about a hash, which does not help an attacker find a valid token. `safeEqual` remains the
   rule for every secret our own code compares (CSRF).
3. **Link:** `${WEB_ORIGIN}/verify-email#token=…`. The token sits in the URL fragment, which
   browsers never send to servers, so it cannot end up in access logs, proxies or `Referer`
   headers. The web page (Phase 7) reads the fragment and posts it to
   `POST /api/v1/auth/verify-email` with a CSRF token.
4. **Verify starts a fresh session.** All earlier sessions of the account are revoked first.
   Used, expired, replaced, unknown and malformed tokens all return 400
   `VERIFICATION_LINK_INVALID`, which the web app shows as "this link is invalid or has
   expired" with a resend button (AC-3).
5. **Resend limits (FR-A4):** for an unverified account, the send times live in
   `users.verificationEmailSentAt` (SRS 5.1). One atomic pipeline update checks "nothing in
   the last 60 s and fewer than 5 in the last hour", prunes older entries, records the send
   and rotates the token. For every other address (unknown, verified, disabled), the same
   rule runs against `verificationThrottles` (keyed by SHA-256 of the email, TTL one hour), so
   the response, including the 429 when the limit is hit, is identical for all addresses
   (AC-14, OQ-25). The signup email counts as the first send.
6. **Signup with an existing unverified address (OQ-21):** the newest signup wins, subject to
   the same FR-A4 limit. Its password and name replace the old ones, `sessionVersion` goes
   up, sessions are revoked and a new link is sent. This defeats pre-registration: someone
   who signs up with another person's address cannot keep a password on that account once
   the real owner signs up. Verified accounts are never changed and get no email.
7. **Delivery:** Resend through its SDK, with React Email templates rendered to HTML and plain
   text. Sending runs in the background (`EmailDispatcher`), so responses do not wait on the
   provider and timing does not reveal whether an email was sent. Retries happen up to 3
   attempts with 1 s and 2 s backoff, but only for network errors, 429 and 5xx; quota and
   validation errors are logged at once. Each message has an `Idempotency-Key`
   (`verify-email/<sha256(token)>`), so a retry after a lost response is not delivered twice.
   Logs name the template and the error code, never the address. Without `RESEND_API_KEY`,
   development writes emails to the local log. Production refuses to start without it.
8. **Cleanup (FR-A12):** `cleanupUnverifiedAccounts` deletes accounts unverified more than
   7 days after `createdAt` in batches, using the SRS index
   `{ emailVerifiedAt: 1, createdAt: 1 }`, plus their sessions and resources. Every delete
   repeats the filter, so an account verified mid-run is kept, and running twice or
   concurrently is harmless. It runs as a one-shot CLI (`node dist/jobs/cli.js
cleanup-unverified`) on the host's cron, which SRS 7 allows, rather than an in-process
   timer that would fire once per API instance. It logs one line containing only the count.

## Alternatives considered

| Option                                                 | Pros                       | Cons                                                                             | Why not chosen                                               |
| ------------------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Token in the query string                              | Common                     | Ends up in access logs, analytics and `Referer`                                  | The fragment never leaves the browser                        |
| Separate `verificationTokens` collection               | Multiple live links        | Not in SRS 5.1; older links would stay valid                                     | One live token per account is simpler and safer              |
| Always 202 for resend, silently dropping limited sends | Simplest way to stay alike | AC-4 "blocked" would be invisible, and the UI could not explain why nothing came | The shadow throttle keeps 429 identical for all addresses    |
| Ignore repeat signups for unverified accounts          | No state change            | A squatter's password survives the owner's verification                          | Newest signup wins, under the resend limit                   |
| Send the email inside the request                      | Simple error handling      | Slow responses and visible timing differences (NFR-S15)                          | Background dispatch with retries                             |
| `node-cron` inside the API                             | No extra service           | Runs once per instance; dies with the web process                                | Host cron plus an idempotent job (both are allowed by SRS 7) |

## Consequences

- **Positive:** links cannot be replayed or leaked through logs, limits are atomic under
  concurrency, and no response reveals whether an address is registered.
- **Negative:** a background send is lost if the process is killed mid-retry (graceful
  shutdown waits for queued sends). The user can resend. Racing a real owner's signup still
  lets a squatter set the password, but only if they sign up again more than 60 s later and
  before the owner clicks the link. The owner would then get two emails, and their own
  password would not work at the next login. The account holds none of the owner's data
  at that point. Closing the gap fully needs password reset, which is out of scope for v1
  (SRS 9). This residual risk is accepted.
- **Follow-ups:** an email-provider-outage runbook and a `/readyz` email check (Phase 13). A
  cron entry in the deployment config (Phase 13, `docs/runbooks/scheduled-jobs.md`). The web
  verify and resend screens (Phase 7).

## Verification

`apps/api/test/auth/verification.test.ts` (AC-3, AC-4, AC-14 resend half, OQ-21, NFR-A4),
`apps/api/src/email/email.test.ts` (retries, Resend transport, template) and
`apps/api/test/jobs/cleanup-unverified.test.ts` (FR-A12, NFR-A5).
