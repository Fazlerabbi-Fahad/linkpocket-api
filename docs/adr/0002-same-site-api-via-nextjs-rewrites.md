# ADR-0002: Serve the API on the web origin through Next.js rewrites

- **Status:** Accepted
- **Date:** 2026-11-01
- **Deciders:** Product and Engineering (Fahad)
- **Requirements:** NFR-S2, NFR-S10, NFR-S11, SRS 2.4, SRS 7 (Hosting), SRS 7.3

## Context

The session cookie is `httpOnly`, `Secure`, `SameSite=Lax` (NFR-S2). SRS 7 hosts the web app
on Vercel and the API on Render or Railway, which by default puts them on different sites
(for example `linkpocket.vercel.app` and `linkpocket-api.onrender.com`). A `SameSite=Lax`
cookie set by a different site is not sent on the browser's `fetch` calls from the web app,
so every authenticated request would fail. Switching to `SameSite=None` would break NFR-S2
and weaken CSRF defences (NFR-S10).

## Decision

The browser only ever calls its own origin. `apps/web/next.config.ts` rewrites
`/api/v1/:path*` to `${API_INTERNAL_URL}/api/v1/:path*`.

- `API_INTERNAL_URL` is a server-only variable (no `NEXT_PUBLIC_` prefix). It replaces
  `NEXT_PUBLIC_API_URL` from SRS 7.3 (OPEN-QUESTIONS OQ-3). Deployed Vercel builds fail if it
  is missing; locally it defaults to `http://localhost:4000`.
- The API sets cookies without a `Domain` attribute, so they are host-only cookies on the
  web origin.
- CORS on the API still allows only `WEB_ORIGIN` (NFR-S11). Proxied requests are
  server-to-server and do not need CORS; direct browser calls to the API host are refused.
- The API must trust exactly one proxy hop (`app.set('trust proxy', 1)`, Phase 3) so rate
  limits (NFR-S14) key on the client IP from `X-Forwarded-For`, not on Vercel's egress IP.
  Phase 3 must verify which header the platform sets and document it.

## Alternatives considered

| Option                                                                           | Pros                                                                                              | Cons                                                                                                                                                                        | Why not chosen                                                                                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Subdomains under one registrable domain: `app.example.com` and `api.example.com` | No proxy hop; API scales and fails independently; `SameSite=Lax` works because both are same-site | Needs a custom domain and DNS for both from day one; cookies need `Domain=example.com` or the API must be called with credentials across origins plus CORS with credentials | Good option once a custom domain exists. Switch by setting the cookie domain and pointing the web app at `https://api.example.com`; no API code change |
| `SameSite=None; Secure` cross-site cookies                                       | Works across any domains                                                                          | Violates NFR-S2; blocked by browsers that restrict third-party cookies                                                                                                      | Not allowed                                                                                                                                            |
| Tokens in `Authorization` header from JS storage                                 | No cookie issues                                                                                  | Violates NFR-S2 (no `localStorage`/`sessionStorage`)                                                                                                                        | Not allowed                                                                                                                                            |

## Consequences

- **Positive:** cookies are first-party; one origin for CSP (`connect-src 'self'`); the API
  host can stay private behind the proxy later.
- **Negative:** an extra network hop (Vercel to API) adds latency, which counts against
  NFR-P1 and NFR-P5 and must be measured in the Phase 14 load test. Vercel function and
  proxy limits (body size, timeouts) apply; our 100 KB body limit (NFR-S7) is well within
  them.
- **Follow-ups:** Phase 3 sets `trust proxy` and tests client-IP rate limiting; Phase 13
  documents the switch to the subdomain option in the deployment runbook.

## Verification

- `apps/web/next.config.ts` contains the rewrite and the deployed-build guard.
- Phase 7 E2E tests run the web app against the API through the rewrite and assert the
  session cookie is sent.
