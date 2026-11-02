# ADR-0008: Gate the admin area on the server and build every admin response from counts

- **Status:** Accepted
- **Date:** 2026-11-01
- **Deciders:** Engineering (build Phase 12)
- **Requirements:** FR-AD1 to FR-AD10, NFR-S5, NFR-S14, NFR-PR3, FR-A8, AC-10, AC-11, AC-12

## Context

Admins see aggregate counts and account summaries, and can disable and enable accounts. They
must never see anyone's links (FR-AD7). Disabling is high-impact, so it needs the admin's
password again (FR-AD10) and an audit entry (FR-AD8). Statistics are computed on page load
(FR-AD9). The first admin comes from a seed script (SRS 2.3).

## Decision

- **Gate.** `/api/v1/admin/*` runs, in order: the admin rate limit (NFR-S14), `requireUser`
  (session, status and sessionVersion read from the database), `requireVerified`, then
  `requireAdmin`, which reads `role` from that same database read. No role is trusted from
  the token or the client (FR-AD2, NFR-S5). Non-admins get 403 `FORBIDDEN`. In the web app,
  `proxy.ts` and `RequireUser role="admin"` redirect non-admins to `/library` as a
  convenience only.
- **Endpoints.** `GET /admin/stats`, `GET /admin/users?q&page`, and
  `PATCH /admin/users/:id/status { status, password }`. All send `Cache-Control: no-store`.
- **No resource content (FR-AD7, AC-12).** The admin service never selects a resource
  document. It only counts resources (`countDocuments`, `$group` by `userId` or by day).
  Responses are assembled field by field and match strict shared schemas, which the contract
  test parses on real responses.
- **Status changes.** The admin's password is checked with `confirmPassword`, which is under
  the FR-A9 lockout. A wrong password answers 401 `REAUTH_REQUIRED`; the web app keeps the
  admin signed in for this code. Admin accounts, including the caller's own, cannot be changed
  (OQ-39). Disabling sets `status`, increments `sessionVersion`, deletes session records, and
  writes `user.disable` (actor = admin id, target, time) in one transaction. Enabling writes
  `user.enable`. Asking for the current status again changes nothing and writes no entry
  (OQ-41).
- **Counts.** "Today" and the 30 trend days are UTC calendar days. The 7- and 30-day windows
  are rolling from now. Totals include every account: unverified, disabled and admins
  (OQ-40). Migration 0008 adds `resources.createdAt_desc` for the global counts (OQ-7).
- **Bootstrap.** `pnpm admin:bootstrap` promotes the existing account named by
  `ADMIN_BOOTSTRAP_EMAIL`. See `docs/runbooks/admin-bootstrap.md`.

## Alternatives considered

| Option                                   | Pros                   | Cons                                                       | Why not chosen                                                            |
| ---------------------------------------- | ---------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| Role in the JWT                          | No database read       | A demoted admin keeps access until the token expires       | FR-AD2 asks for a server check on every request; we already read the user |
| Short-lived "sudo" session after re-auth | Fewer password prompts | More state, and a window in which a stolen session can act | Disabling is rare; asking each time is simpler and safer                  |
| Precomputed stats (a scheduled job)      | Fast pages at scale    | Stale numbers; FR-AD9 says computed on page load           | Indexed counts are fast enough for v1 (NFR-P4 checked in Phase 14)        |
| Let admins disable other admins          | Handles a rogue admin  | Two admins can lock each other out from the UI             | v1 has few admins; role changes stay an operator task (runbook)           |

## Consequences

- **Positive:** A non-admin cannot reach admin data even with a crafted client. Losing the
  role or being disabled takes effect on the next request. The no-leak rule is enforced by
  construction and by a contract test.
- **Negative:** Each admin request reads the user (already true for every request). Stats
  run about a dozen indexed counts per page load.
- **Follow-ups:** Load-test `GET /admin/stats` at 500,000 resources (NFR-P4, Phase 14).
  A role-management screen if more than a couple of admins are ever needed.

## Verification

`apps/api/test/admin/admin-access.test.ts` (AC-10, rate limits), `admin-stats.test.ts` (AC-11),
`admin-users.test.ts` (FR-AD5, FR-AD6, FR-AD8, FR-AD10, AC-12 contract), `bootstrap.test.ts`,
and `apps/web/e2e/admin.spec.ts` plus the admin part of `a11y.spec.ts`.
