# Runbook: observability (logs, errors, dashboards, alerts)

Status: **code done; dashboards, alerts, log drain and uptime checks are manual setup.**
NFR-O1 to NFR-O4, NFR-A1, NFR-B5, NFR-B6, ADR-0009.

## What the API emits

**Request log (NFR-O1).** One JSON line per request on stdout:

```json
{
  "level": 30,
  "service": "linkpocket-api",
  "req": { "id": "6f1c…", "method": "GET" },
  "res": { "statusCode": 200 },
  "route": "/api/v1/resources/:id",
  "userId": "665f…",
  "responseTime": 12,
  "msg": "request completed"
}
```

- `req.id` matches the `X-Request-Id` response header and the `requestId` in error bodies.
- `route` is the template, never the concrete path. Unknown paths log `unmatched`.
- `errorCode` appears on 4xx and 5xx lines (for example `INVALID_CREDENTIALS`).
- Levels: 2xx and 3xx `info` (30), 4xx `warn` (40), 5xx `error` (50).

**Never logged (NFR-B6, AC-21):** passwords, tokens, cookies, headers, request bodies, query
strings (search terms), resource URLs, titles, notes and email addresses. Error lines keep
only the error class, code and stack frames, not the message. This is enforced by
`test/observability/log-audit.test.ts`. In local development without Resend, the
verification email (with its link) is written to the console on purpose (OQ-47). Production
refuses to start without Resend.

**Events used by alerts:**

| Event / field                                  | Meaning                                                       |
| ---------------------------------------------- | ------------------------------------------------------------- |
| `route="/api/v1/auth/login"` + `errorCode`     | failed login (`INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`)        |
| `event="email_send_failed"` (`reason`)         | email dropped after retries (NFR-A4)                          |
| `event="email_send_retry"`                     | a retry is scheduled                                          |
| `event="breach_check_unavailable"`             | HIBP unreachable, check skipped (fail open)                   |
| `event="job_completed"` / `event="job_failed"` | scheduled job outcome                                         |
| `event="rate_limits_scaled"`                   | load-test multiplier active (must never appear in production) |

## Error tracking (NFR-O2)

- [ ] Sentry organisation with two projects, `linkpocket-api` (Node) and `linkpocket-web`
      (Next.js).
- [ ] DSNs: `SENTRY_DSN` on Render, `NEXT_PUBLIC_SENTRY_DSN` on Vercel, per environment.
      `APP_ENV` / `NEXT_PUBLIC_APP_ENV` set the Sentry environment.
- [ ] Source maps: an org auth token with "project releases" scope in `SENTRY_AUTH_TOKEN`
      (Render and Vercel), plus `SENTRY_ORG` and `SENTRY_PROJECT`. The API's Render build runs
      `pnpm sentry:sourcemaps`. The web build uploads through `withSentryConfig` and deletes the
      maps so they are never served.
- [ ] Check once per environment: trigger a test error and confirm the stack trace shows
      TypeScript file names and lines.
- [ ] Project settings → Security & Privacy: **Data Scrubber on**, **Use Default Scrubbers on**,
      **Prevent Storing of IP Addresses on**. This adds to the app's own scrubbing.

What is sent: unexpected (500) API errors with `requestId`, `route` and `userId` tags; browser
and server rendering errors from the web app. Nothing else: no performance traces, no
session replay, no breadcrumbs. Every event is scrubbed of request data, users, URLs and
emails (`src/shared/observability.ts`). Browser events go to `/monitoring` on the web
origin, which forwards them, so the CSP still allows only `'self'`.

## Logs: drain and retention (NFR-B5)

- [ ] Render → Log Streams: send both API services and both jobs to one log tool (for example
      Better Stack or Datadog) that can query JSON fields.
- [ ] Retention **30 days** for application logs. Audit logs are in MongoDB with a 1-year TTL,
      separately.
- [ ] Access limited to the team. Logs hold user IDs only, but treat them as confidential.

## Dashboards (NFR-O3)

One dashboard per environment, with these panels:

| Panel          | Query (log fields)                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| Request rate   | count by `route`, 1-minute buckets                                                                    |
| Error rate     | share of lines with `res.statusCode >= 500`, plus a Sentry issues widget                              |
| p95 latency    | p95 of `responseTime` for `route` starting `/api/v1/resources`; also all routes                       |
| Failed logins  | count where `route="/api/v1/auth/login"` and `errorCode` in (`INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`) |
| Lockouts       | count of `errorCode="ACCOUNT_LOCKED"`                                                                 |
| Email failures | count of `event="email_send_failed"` by `reason`                                                      |
| Scheduled jobs | latest `job_completed` (`deleted`, `durationMs`) and any `job_failed`                                 |
| Readiness      | uptime monitor status for `/readyz`, with the `email` check result                                    |

## Alerts (NFR-O3, NFR-O4)

All alerts go to the on-call channel. SEV1 also pages the on-call person.

| Alert                          | Condition                                                                           | Severity |
| ------------------------------ | ----------------------------------------------------------------------------------- | -------- |
| API down                       | uptime check on `/healthz` fails for 2 minutes                                      | SEV1     |
| Web down                       | uptime check on `https://<domain>/` fails for 2 minutes                             | SEV1     |
| Not ready                      | `/readyz` returns 503 for 3 minutes                                                 | SEV1     |
| Error rate                     | 5xx above 2% of requests for 5 minutes (and at least 20 errors)                     | SEV2     |
| New Sentry issue in production | first seen, `level:error`                                                           | SEV3     |
| p95 latency                    | resource routes p95 above 300 ms for 10 minutes (NFR-P5)                            | SEV2     |
| Failed-login spike             | more than 50 in 5 minutes, or 5 times the 7-day baseline                            | SEV2     |
| Email failures                 | 5 or more `email_send_failed` in 15 minutes, or `/readyz` email fail for 10 minutes | SEV3     |
| Cleanup job failed             | `job_failed`, or a non-zero exit                                                    | SEV4     |
| Cleanup job missing            | no `job_completed` in 48 hours                                                      | SEV4     |
| Load-test mode in production   | any `event="rate_limits_scaled"` from production                                    | SEV2     |

## Uptime (NFR-A1)

- [ ] An external uptime monitor (Better Stack, Pingdom or similar) checks the web home page,
      `/healthz` and `/readyz` every minute from two regions.
- [ ] A monthly availability report from it. The target is 99.5% excluding announced
      maintenance, which is about 3.6 hours a month.
- [ ] A public status page, linked from the incident templates (`incident-communication.md`).

## On-call (NFR-O4)

- [ ] An on-call rotation with a paging tool. One primary at a time.
- [ ] The alert channel, and the paging tool's escalation after 15 minutes without
      acknowledgement.
- [ ] Severity levels SEV1 to SEV4 as defined in `incident-response.md`.
