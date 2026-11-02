# ADR-0001: Back each JWT with a server-side session record

- **Status:** Accepted
- **Date:** 2026-11-01
- **Deciders:** Product and Engineering (Fahad)
- **Requirements:** FR-A6, FR-A8, FR-A11, FR-A13, NFR-S2, NFR-S3, AC-13, AC-16

## Context

SRS 7 describes auth as "stateless sessions with server-side revocation via
`sessionVersion`". That covers revoking _all_ of a user's sessions (password change, disable,
logout-all, NFR-S3), but FR-A6 also requires that logout "invalidates ... the server-side
session record" for _one_ session. A version counter on the user cannot end one session
without ending the others, and FR-A8's admin rule ("24 hours regardless of activity") needs
the login time of each session. FR-A13 (list and sign out other sessions) needs a per-session
record too.

## Decision

1. Add a `sessions` collection (Mongoose model `AuthSession`):

   | Field        | Type           | Notes                                               |
   | ------------ | -------------- | --------------------------------------------------- |
   | `_id`        | ObjectId       |                                                     |
   | `userId`     | ObjectId       | ref `users`, immutable                              |
   | `jti`        | string         | random ID carried in the JWT, unique index          |
   | `createdAt`  | Date           | login time, immutable                               |
   | `lastUsedAt` | Date           | updated on use (throttled, Phase 3)                 |
   | `expiresAt`  | Date           | see rule below, TTL index (`expireAfterSeconds: 0`) |
   | `revokedAt`  | Date \| null   | set by logout                                       |
   | `userAgent`  | string \| null | truncated to 512 characters, for FR-A13 display     |

   Indexes: `jti_unique`, `userId_createdAt` (`{ userId: 1, createdAt: -1 }`), `expiresAt_ttl`.

2. The JWT (in the `httpOnly`, `Secure`, `SameSite=Lax` cookie, NFR-S2) carries `sub` (user
   ID), `jti` and `sessionVersion`.

3. Auth middleware accepts a request only when all of these hold:
   - the JWT signature and `exp` are valid;
   - the user exists, `status === "active"`, and `emailVerifiedAt` is set where the route
     requires a verified user;
   - the JWT's `sessionVersion` equals the user's `sessionVersion`;
   - a session with that `jti` and `userId` exists, `revokedAt` is null and `expiresAt` is in
     the future.

4. `expiresAt = min(lastUsedAt + 7 days, createdAt + 24 hours if admin)` (FR-A8 and
   clarification 5), computed by `computeSessionExpiry` in
   `apps/api/src/db/models/session.model.ts` and recomputed when `lastUsedAt` moves.

5. Logout sets `revokedAt` on that session and clears the cookie. Password change, disable
   and logout-all still increment `users.sessionVersion`, which invalidates every session in
   one write without touching the `sessions` collection.

## Alternatives considered

| Option                                   | Pros                          | Cons                                                                                      | Why not chosen                              |
| ---------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------- |
| `sessionVersion` only (SRS 7 as written) | No extra collection or lookup | Logout cannot revoke one session server-side; admin 24 h rule needs login time; no FR-A13 | Fails FR-A6                                 |
| Opaque session ID in the cookie, no JWT  | Simplest revocation model     | Contradicts NFR-S2 ("Session tokens are JWTs")                                            | Conflicts with the SRS                      |
| JWT deny-list of revoked `jti`s          | Small table                   | Still needs login time for FR-A8; no session list                                         | Weaker than a full record for the same cost |

## Consequences

- **Positive:** single-session logout, per-session expiry, FR-A13 becomes a simple query, and
  revoked or expired records clean themselves up through the TTL index.
- **Negative:** one indexed read per authenticated request (by unique `jti`), plus a throttled
  write for `lastUsedAt`. Acceptable against NFR-P5 (p95 < 300 ms).
- **Privacy:** `userAgent` is not in NFR-PR1's list of stored data. It is kept short-lived
  (deleted with the session) and only for FR-A13. See OPEN-QUESTIONS OQ-4.
- **Follow-ups:** Phase 3 implements the middleware, cookie issuing and `lastUsedAt`
  throttling; account deletion (Phase 6) deletes the user's sessions.

## Verification

- `apps/api/src/db/models/session.model.test.ts`: validation, unique `jti`, revocation,
  expiry rule for users and admins.
- `apps/api/test/schema-drift.test.ts` and `runner.test.ts`: indexes and TTL exist.
- Phase 3: integration tests for logout (FR-A6), disable (AC-13) and password change (AC-16).
