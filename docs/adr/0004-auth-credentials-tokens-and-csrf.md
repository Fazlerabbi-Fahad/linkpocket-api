# ADR-0004: Argon2id passwords, derived-key JWTs and signed double-submit CSRF

- **Status:** Accepted
- **Date:** 2026-11-01
- **Deciders:** Product and Engineering (Fahad)
- **Requirements:** NFR-S1, NFR-S2, NFR-S9, NFR-S10, FR-A9, FR-A10, NFR-S15

## Context

Phase 3 builds the auth API. NFR-S1 allows "bcrypt, cost factor 12, or Argon2id if the
platform supports it". FR-A10 allows passwords up to 128 characters. NFR-S10 asks for a
double-submit CSRF token in a header. Clarification 4 fixes breached-password screening on
HIBP plus a bundled common-password list.

## Decision

1. **Passwords: Argon2id** via `@node-rs/argon2` (prebuilt binaries, no install script), at
   the OWASP minimum `m=19456 KiB, t=2, p=1`. bcrypt ignores everything after 72 bytes, so
   with 128-character passwords two different passwords could match. Tests use lower
   parameters, and only when `NODE_ENV=test` (`apps/api/src/config.ts`).
2. **Unknown emails cost the same as known ones.** Login runs a check against a dummy hash
   when there is no account, and signup screens and hashes the password before it checks
   whether the email exists.
3. **JWT signing key** is derived with HKDF-SHA256 from `JWT_SECRET` (`purpose = session-jwt`).
   The CSRF key is derived the same way (`purpose = csrf`). One secret to rotate, independent
   keys. Tokens are HS256 only, with fixed `iss`/`aud`, and carry `sub`, `jti` and `sv`
   (ADR-0001).
4. **Cookies** are `__Host-lp_session` (httpOnly) and `__Host-lp_csrf` (readable by the web
   app). The `__Host-` prefix forces Secure, `Path=/` and no `Domain`, which matches the
   same-origin proxy in ADR-0002.
5. **CSRF: signed double-submit.** A token is `nonce.HMAC(csrfKey, binding + "." + nonce)`.
   The binding is the session's `jti`, or `anon` before login. Every POST, PATCH and DELETE
   under `/api/v1` must send the token in `X-CSRF-Token`. The header must equal the cookie,
   and the MAC must be valid for the current session. Login, change-password and logout
   issue a new token. The web app gets its first one from `GET /api/v1/auth/csrf`.
6. **Lockout (FR-A9)** is counted per email in `loginAttempts`, keyed by SHA-256 of the
   normalized email, and updated in one atomic pipeline update. Wrong current passwords on
   change-password count too. When the lock starts, one `auth.login_failed_lockout` audit
   entry is written with actor `system`.
7. **Breached passwords:** the HIBP range API is called with the first 5 SHA-1 hex
   characters and `Add-Padding: true`, with a 2.5 s timeout. If HIBP is unreachable, the
   check fails open and a warning is logged with no password data. The 10,000-entry common
   list is bundled in `apps/api/data/` (SecLists, MIT License).

## Alternatives considered

| Option                                          | Pros                                    | Cons                                                                                         | Why not chosen                                         |
| ----------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| bcrypt cost 12                                  | Named first in NFR-S1, very widely used | 72-byte truncation conflicts with 128-character passwords; pre-hashing adds its own pitfalls | Argon2id avoids the problem                            |
| Plain double-submit (random cookie = header)    | Simpler                                 | A cookie planted by a sibling subdomain bypasses it                                          | The signed variant costs one HMAC                      |
| Synchronizer token stored in the session record | Strong                                  | Needs a store for anonymous visitors (login, signup)                                         | The signed token needs no storage                      |
| `bcryptjs` / `jsonwebtoken`                     | Familiar                                | Slower pure-JS hashing / older callback API                                                  | `@node-rs/argon2` and `jose` fit strict ESM TypeScript |

## Consequences

- **Positive:** no truncation, memory-hard hashing, CSRF tokens tied to the session, and no
  plaintext emails stored for lockouts on unknown addresses.
- **Negative:** each Argon2id hash uses about 19 MiB for roughly 50 ms. Login and signup rate
  limits (NFR-S14) cap that cost. Rotating `JWT_SECRET` signs everyone out, and the rotation
  runbook (Phase 13) must say so.
- **Follow-ups:** a shared rate-limit store before running more than one API instance
  (OQ-18). Load-test login cost in Phase 14.

## Verification

`apps/api/src/auth/*.test.ts` (hashing, tokens, CSRF, screening), and the Supertest suites in
`apps/api/test/auth/` and `apps/api/test/security.test.ts`.
