# Runbook: load testing

Status: **manual run against staging** before each major release (NFR-P6). Script:
`load/k6/resources.js`. Workflow: **Load test (staging)** (`.github/workflows/load-test.yml`).
Targets:

| Requirement   | Target                                                  | How it is checked                                    |
| ------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| NFR-P5        | resource endpoints p95 < 300 ms at 200 concurrent users | k6 threshold `http_req_duration{endpoint:resources}` |
| AC-19, NFR-P2 | search p95 < 300 ms, 500-link library                   | k6 threshold `http_req_duration{name:search}`        |
| NFR-P1        | library loads < 2 s (p95) on 4G, 500 links              | manual: Lighthouse or WebPageTest, below             |
| NFR-P4        | admin overview < 2 s (p95), 10,000 users, 500,000 links | manual: larger seed, below                           |
| NFR-P3        | QR in < 200 ms for 2,048-character URLs                 | automated: `frontend/e2e/performance.spec.ts`        |

Run against **staging only**, never production. Staging has production-sized instances, or
the results don't count.

## Before the run

1. **Raise the rate limits** on staging. One load generator would otherwise hit the per-IP
   limits (NFR-S14). Render → `linkpocket-staging` group → `RATE_LIMIT_MULTIPLIER=100` → Save
   (the API restarts and logs `rate_limits_scaled`). The API refuses this setting when
   `APP_ENV=production`.
2. **Seed accounts.** Render → `linkpocket-api-staging` → **Shell**:

   ```bash
   LOAD_TEST_PASSWORD='<the staging secret>' pnpm load:seed
   ```

   This creates `load-0001@loadtest.invalid` … `load-0200@loadtest.invalid`, verified, with 500
   links each. The `.invalid` domain can never receive email. Re-running only tops up.

3. Check that `LOAD_TEST_PASSWORD` in the GitHub `staging` environment matches.

## Run

Actions → **Load test (staging)** → Run workflow (defaults: 200 users, 5-minute hold). Or locally
with k6 installed:

```bash
k6 run -e BASE_URL=https://staging.<domain> -e LOAD_TEST_PASSWORD=... load/k6/resources.js
```

Each virtual user logs in once, then repeats a loop with one second of think time between
loops: list, search, filter by tag, save, pin, get, delete. Requests go through the web origin
like a browser's (ADR-0002), so the measured latency includes the Vercel rewrite.

## Read the result

- The job fails if any threshold fails. The summary printed at the end lists each threshold
  with `ok: true/false`. The full numbers are in the `k6-summary` artifact (kept 90 days).
- Also look at the staging dashboards during the run: CPU, memory, Atlas metrics, and whether
  the API's own `responseTime` p95 agrees with k6's.
- **On a miss:** check Atlas slow queries (the resource list and text search must use
  `library_order` and `resource_text`), instance size, and connection pool use. Fix, then run
  again. A release with failed targets needs product owner sign-off.

## Manual checks

**NFR-P1.** Log in as `load-0001@loadtest.invalid` on staging in Chrome. In DevTools
Lighthouse, use mobile with "Simulated throttling (Slow 4G)", or use WebPageTest's 4G profile,
on `/library`. Record the time to the first card being visible. Five runs; the slowest of the
best four (p95-ish) must be under 2 s.

**NFR-P4.** Seed a larger set (`LOAD_USERS=10000 LOAD_RESOURCES=50`, about 500,000 links). Open
`/admin` as the staging admin and record the `GET /api/v1/admin/stats` time from the API logs
(`route="/api/v1/admin/stats"`) over 20 refreshes. The p95 must be under 2 s.

## After the run

1. `pnpm load:seed --clean` in the same shell. This removes the
   load-test accounts and their links.
2. Set `RATE_LIMIT_MULTIPLIER` back to `1` and save.
3. Record the result:

| Date | Commit | Users | p95 resources | p95 search | Errors | NFR-P1 | NFR-P4 | Result |
| ---- | ------ | ----- | ------------- | ---------- | ------ | ------ | ------ | ------ |
|      |        |       |               |            |        |        |        |        |
