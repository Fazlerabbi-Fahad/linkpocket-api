# ADR-0009: Log by route template, report scrubbed errors only, and release through a gated pipeline

- **Status:** Accepted
- **Date:** 2026-11-01
- **Deciders:** Engineering (build Phases 13 and 14)
- **Requirements:** NFR-O1 to NFR-O4, NFR-B6, NFR-A2, NFR-P5, NFR-P6, NFR-S12, AC-19, AC-20,
  AC-21, SRS 10.1, SRS 10.2

## Context

NFR-O1 asks for structured logs with request ID, method, route, status and duration. NFR-B6
forbids passwords, tokens, cookies and full resource URLs in logs. NFR-O2 asks for error
tracking with source maps on both apps, and the same privacy rule applies there in spirit.
NFR-A2 asks for liveness and readiness endpoints, with readiness covering the database and
email. SRS 10.1 asks for staging, a smoke test, a manual production approval and a 30-minute
watch. NFR-P5 asks for a load test at 200 concurrent users, but the API's per-IP rate limits
(NFR-S14) would throttle a single load generator.

## Decision

- **Request log.** `pino-http` writes one line per request with `req.id` (also
  `X-Request-Id`), method, **route template** (`/api/v1/resources/:id`; the router's mount
  path is recorded by `recordRouteBase`), status, `responseTime`, `errorCode` on errors, and
  `userId` when signed in. No path, query string, headers or body. 4xx lines are `warn`, 5xx
  lines are `error`. Failed logins are counted from `route` plus `errorCode`, with no
  separate event.
- **Errors in logs** keep only the class, code and stack frames (`serializeError`). Messages
  can quote input (a duplicate key's email, a cast value), so they are dropped from logs.
- **Redaction** covers top-level and one-level-nested secret keys. The AC-21 log-audit test
  drives every endpoint family through the production logger and searches the output for each
  secret it handled.
- **Sentry**, only when a DSN is set: errors only, with no tracing, replay or breadcrumbs, and
  `dataCollection` off for users, cookies, headers, bodies and query strings. A shared
  `scrubErrorEvent` (`packages/shared`) runs in `beforeSend` in both apps. It removes request
  data, users, breadcrumbs and `extra`, and replaces URLs and emails in messages. The API
  reports only unexpected 500s, through an `ErrorReporter` passed into the error handler (a
  fake in tests). The web app uses `@sentry/nextjs` with a same-origin tunnel (`/monitoring`),
  so the CSP keeps `connect-src 'self'`. Source maps are uploaded at build time and are never
  served.
- **Readiness.** `/healthz` touches nothing. `/readyz` pings the database (critical: 503) and
  checks Resend reachability (non-critical: 200 with `"status": "degraded"`). An email outage
  must not pull every API instance out of rotation (OQ-44). The email result is cached for
  60 seconds. Responses name each check with `ok` or `fail` and nothing else.
- **Release.** CI on `main` starts `deploy.yml`. One reusable workflow deploys a commit to an
  environment:
  1. Render API through its REST API by commit SHA, waiting until it is live. Migrations run in
     Render's pre-deploy step, so a failed migration stops the switch.
  2. The cleanup job.
  3. Vercel prebuilt.
  4. A smoke test.

  Production uses the same workflow behind the `production` GitHub environment's required
  reviewers, then a 30-minute `/readyz` watch. Platform auto-deploys are off, so the pipeline
  is the only way to production.

- **Load tests.** k6 against staging through the web origin, with thresholds for NFR-P5 and
  AC-19. The API reads `RATE_LIMIT_MULTIPLIER` (1–1000) to scale per-IP limits for the test,
  and refuses any value other than 1 when `APP_ENV=production` (OQ-45). Seeded accounts use
  the reserved `.invalid` domain.
- **SCA** (OQ-16): GitHub dependency review on pull requests, failing on high, alongside
  `pnpm audit --audit-level high` on every run. Dependabot opens monthly updates (NFR-M7).

## Alternatives considered

| Option                                       | Pros                          | Cons                                                    | Why not chosen                                                   |
| -------------------------------------------- | ----------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| Log the concrete path                        | Easy to grep for one resource | High cardinality; IDs in every line                     | The route template meets NFR-O1; `userId` and `req.id` correlate |
| Keep error messages in logs, redact by regex | Easier debugging              | Titles, notes and cast values can't be matched reliably | NFR-B6 is a must; Sentry gets a scrubbed message for debugging   |
| Sentry auto-instrumentation and tracing      | Latency data in Sentry        | Spans carry URLs and queries; more data leaving         | p95 comes from logs (`responseTime`) and k6                      |
| Email failure makes `/readyz` 503            | Simple "all green or not"     | A Resend outage would take the whole API down           | Login and libraries don't need email                             |
| Migrations from GitHub Actions               | Visible in the run            | Atlas would have to allow GitHub's IP ranges            | Render's pre-deploy step runs inside the allowed network         |
| Separate test-only API for load tests        | No config switch              | Doesn't measure the real deployment                     | NFR-P6 asks to test what ships                                   |
| OSV-Scanner as SCA                           | Free, offline database        | No severity gate: low findings would block releases     | dependency review gates on severity; OSV can be added later      |

## Consequences

- **Positive:** Logs and error reports are safe to share inside the team. The privacy rule
  is enforced by tests, not by review alone. Every production change passes the same checks
  and a named approver.
- **Negative:**
  - Debugging a 500 needs Sentry for the message, because the log has only the stack.
  - Rotating `JWT_SECRET` signs everyone out (no dual keys; `secret-rotation.md`).
  - Dependency review needs GitHub Advanced Security on private repositories.
  - The deploy scripts depend on the Render and Vercel APIs, and their first run needs
    checking on real accounts.
- **Follow-ups:** the manual setup in `docs/runbooks/deployment.md` and `observability.md`. A
  first staging run of `load-test.yml`.

## Verification

- `apps/api/test/observability/log-audit.test.ts` (AC-21)
- `request-log.test.ts` (NFR-O1, NFR-O2, failed-login field)
- `readiness.test.ts` (NFR-A2)
- `packages/shared/src/observability.test.ts` (scrubbing)
- `apps/api/src/config.test.ts` (multiplier guard)
- `apps/web/e2e/keyboard.spec.ts` (AC-20 keyboard path)
- `apps/web/e2e/performance.spec.ts` (NFR-P3)
- `load/k6/resources.js` (NFR-P5, AC-19; run on staging)
