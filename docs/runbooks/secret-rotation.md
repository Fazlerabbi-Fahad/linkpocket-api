# Runbook: secret rotation

Status: **manual**. NFR-S13: secrets live only in the hosting providers' secret managers (Render
environment groups, Vercel environment variables, GitHub environment secrets), never in the
repository. SRS 10.3: suspected data exposure triggers an immediate rotation review.

**When:** every 12 months, when someone with access leaves, and at once on suspected
exposure. Always rotate staging first, check it, then production.

## `JWT_SECRET` (API)

Session tokens and CSRF tokens are both derived from this secret (ADR-0004). There is no
dual-key period, so **rotating it signs every user out** and invalidates open CSRF tokens.
Users log in again and lose no data.

1. Generate a new value: `openssl rand -base64 48` (at least 32 characters).
2. Render → environment group `linkpocket-staging` → `JWT_SECRET` → paste → **Save**. Render
   restarts the staging API.
3. Check staging: `/readyz` is 200. An old session gets 401 `SESSION_EXPIRED`. Logging in works.
4. For a routine rotation, pick a quiet hour. For a suspected leak, do it now.
5. Repeat on `linkpocket-production`, then check the same way.
6. Sessions stored server-side are not deleted. They fail verification and expire through
   their TTL. To remove them at once (after a leak): `db.sessions.deleteMany({})` in the
   Atlas shell.
7. Record the date and reason in the secrets log.

## `RESEND_API_KEY` (API)

1. Resend → API Keys → **Create**: "Sending access", limited to the LinkPocket domain, named
   `linkpocket-<env>-<yyyy-mm>`.
2. Render → environment group → `RESEND_API_KEY` → paste → **Save** (the API restarts).
3. Check: `/readyz` reports `"email": "ok"`. Sign up a test address you control on staging (on
   production, use "resend verification" for a test account) and confirm the email arrives.
4. Resend → delete the old key. Do this only after step 3; until then both keys work.

## Other secrets

| Secret                                  | Where                     | How to rotate                                                                                                                                                      |
| --------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Atlas database password (`MONGODB_URI`) | Render environment groups | Atlas → Database Access → edit user → new password. Update `MONGODB_URI` straight away (the API reconnects on restart). A second user lets you switch with no gap. |
| `SENTRY_AUTH_TOKEN`                     | Render, Vercel            | Sentry → Auth Tokens → create (scope: project releases) → update both → revoke the old one. Affects only source map upload.                                        |
| `RENDER_API_KEY`                        | GitHub environments       | Render → Account → API Keys → create → update the secret in both environments → revoke the old key.                                                                |
| `VERCEL_TOKEN`                          | GitHub environments       | Vercel → Tokens → create (team scope) → update → delete the old token.                                                                                             |
| `LOAD_TEST_PASSWORD`                    | GitHub `staging` only     | New value, then re-run `load:seed --clean` and `load:seed` on staging.                                                                                             |

`SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` are not secrets: they are public by design. If one is
abused for spam, rotate the client key in Sentry project settings.

## After a suspected exposure

- [ ] Rotate the exposed secret and anything stored next to it.
- [ ] Review logs for use of the secret (unusual login patterns, admin actions in `auditLog`).
- [ ] Follow `incident-response.md`. Exposure is SEV1 until shown otherwise.
