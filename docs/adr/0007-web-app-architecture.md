# ADR-0007: Build the web app as client-rendered screens behind a nonce CSP

- **Status:** Accepted
- **Date:** 2026-11-01
- **Deciders:** Engineering (build Phases 7 to 11)
- **Requirements:** FR-A3, FR-A5, FR-A7, FR-C1 to FR-C5, FR-L1 to FR-L6, FR-U3, NFR-S10,
  NFR-S11, NFR-S16, NFR-PR2, NFR-A3, NFR-U1 to NFR-U5

## Context

The browser talks only to the web origin; Next.js rewrites `/api/v1/*` to the API (ADR-0002).
Every state-changing call needs the double-submit CSRF header (ADR-0004). SRS NFR-S11 asks for
a strict CSP. The library is interactive (optimistic pins, debounced search, dialogs), and
every screen depends on who is signed in.

## Decision

- **CSP.** `apps/web/proxy.ts` makes a per-request nonce and sets
  `script-src 'self' 'nonce-…' 'strict-dynamic'` (plus `'unsafe-eval'` in development only),
  `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
  `connect-src 'self'`. `img-src` allows `https:` for favicons (hostname only, no referrer)
  and `data:` for QR codes. Styles allow `'unsafe-inline'` (React style attributes and
  Radix positioning) and Fontshare (OQ-34). The root layout reads the nonce with `headers()`,
  so pages render per request.
- **API client.** `apps/web/lib/api.ts` sends same-origin requests, adds `X-CSRF-Token` from
  the `__Host-lp_csrf` cookie (fetching `/auth/csrf` first if missing) and retries once on
  `CSRF_INVALID`. Errors become `ApiError(status, code, message, fields)`.
- **Protected routes, two layers.** `proxy.ts` redirects a request without the session
  cookie to `/login?next=<path+query>` before rendering. `RequireUser` (client) handles
  sessions that exist but are expired, revoked or unverified, using `GET /auth/me`. A 401 from
  any later query or mutation clears the cached user, which sends the user to login with the
  current page as `next`. `safeNext` accepts only same-site paths and never the auth pages.
- **Verification link.** The token is read from the URL fragment, removed with
  `history.replaceState`, and posted once. The page also listens for `hashchange`, so a link
  opened in a tab that already shows `/verify-email` works.
- **Data.** TanStack Query holds the library as an infinite query keyed by the filters.
  Filters (`q`, `tag`, `pinned`) live in the address. Pins are optimistic (a pinned link
  moves to the top at once), rolled back with a visible notice on failure, and refetched on
  settle so the server order wins.
- **Forms.** React Hook Form with the shared Zod rules (`resourceUrlSchema`, `tagsSchema`,
  `titleInputSchema`, `noteSchema`). API field errors are mapped back onto the same fields.
- **Rendering of user content.** React text nodes only; ESLint bans
  `dangerouslySetInnerHTML`. Links open only stored http(s) URLs with
  `rel="noopener noreferrer"`.

## Alternatives considered

| Option                                    | Pros                                       | Cons                                                                                           | Why not chosen                                                         |
| ----------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Server components fetching the library    | Less client JavaScript, faster first paint | Needs the session cookie forwarded server-to-server; optimistic pins still need a client cache | Library is interaction-heavy; doubled data paths for little gain in v1 |
| Static CSP with hashes                    | Pages can be cached                        | Next.js inline bootstrap scripts change per build; brittle                                     | Nonce with `strict-dynamic` is the documented approach                 |
| Guard only in the proxy (cookie presence) | One place                                  | A revoked or expired cookie still renders a broken page                                        | Server truth is `/auth/me`; both layers are cheap                      |

## Consequences

- **Positive:** One API path for every screen; CSRF and error handling live in one helper;
  filtered views can be bookmarked; the guard keeps the destination through login and the
  verify-email detour.
- **Negative:** Pages are rendered per request (no static caching) because of the nonce. The
  library shows a loading state before data arrives.
- **Follow-ups:** Self-host fonts and drop Fontshare from the CSP (OQ-34, before launch).
  Add a test that asserts the CSP header (Phase 14). Admin screens (Phase 12) reuse
  `RequireUser` with a role check.

## Verification

`apps/web/e2e/library.spec.ts` (AC-1, AC-5, AC-6, FR-A7, NFR-A3, CRUD, search and tags),
`apps/web/e2e/a11y.spec.ts` (axe in light and dark at 360 px), `apps/web/lib/*.test.ts`
(`safeNext`, favicon URLs, shared form rules, QR decode for AC-7). The CI `e2e` job runs both
Playwright specs.
