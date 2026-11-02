# Runbook: deployment

Status: **automated pipeline, manual one-time setup and a manual production approval.**
SRS 10.1, NFR-M5, NFR-S13. Two repositories (ADR-0010), kept on disk as `lp/api` and `lp/frontend`, each with
`.github/workflows/ci.yml`, `deploy.yml` and `deploy-environment.yml`: **api** deploys to Render
(`render.yaml`: API and scheduled job) and **frontend** deploys to Vercel (`vercel.json`).

## How a release flows

Each repository releases on its own, the same way:

1. A pull request with at least one approving review merges to `main` (branch protection).
2. CI runs on `main`: format, lint, typecheck, tests with coverage, `pnpm audit` and build.
   The API also loads its compiled modules; the web app also runs Playwright E2E and axe
   accessibility against the API checked out from the api repository.
3. A green CI run starts **Deploy**. Staging gets the same commit:
   - **API:** Render deploys it; the pre-deploy command runs `migrate:dist up`, and a failed
     migration stops the deploy while the old version keeps serving. Render moves the cleanup
     job to the same commit. `smoke.sh` checks `/healthz`, `/readyz` and a signed-out
     `/api/v1/auth/me`.
   - **Web:** Vercel builds with the Preview (staging) settings and the staging domain is
     aliased to that build. `smoke.sh` checks the home and login pages and an API call through
     the web origin.
4. **Production waits for approval** on the `production` GitHub environment of that
   repository. The approver checks the list under "Before approving", then approves.
5. Production deploys the same way. For the API, `watch.sh` then checks `/readyz` every
   minute for 30 minutes while the approver watches the dashboards (`observability.md`).

A newer release waits for one in progress; nothing is cancelled half-way.

**Order across the two repositories.** The API ships first and stays backward compatible within
`/api/v1` (NFR-M6): add fields and endpoints, then release the web app that uses them, and
remove old behaviour only after the web release is live. A change to the shared code
(`src/shared/` in the API, `shared/` in the web app) is made in both repositories with the
same content; the web E2E run against the API's `main` catches a contract mismatch.

## One-time setup (manual)

### GitHub (in both repositories)

- [ ] Branch protection on `main`: pull request required, 1 approving review, dismiss stale
      approvals, and required status checks `Lint, typecheck, test, build` and
      `Dependency audit`, plus `End-to-end and accessibility (Playwright, axe-core)` in
      frontend.
- [ ] Environment `staging`: deployment branches limited to `main`.
- [ ] Environment `production`: **required reviewers** (at least one person other than the
      author; tick "Prevent self-review"), deployment branches limited to `main`.
- [ ] Variables and secrets for each environment (the Repository column says where):

| Name                     | Kind     | Repository | Value                                                                        |
| ------------------------ | -------- | ---------- | ---------------------------------------------------------------------------- |
| `API_URL`                | variable | api        | the Render service URL (for health checks)                                   |
| `RENDER_API_SERVICE_ID`  | variable | api        | `srv-…` of `linkpocket-api-staging` / `linkpocket-api`                       |
| `RENDER_CRON_SERVICE_ID` | variable | api        | `crn-…` of the matching cleanup job                                          |
| `RENDER_API_KEY`         | secret   | api        | Render API key of a deploy-only team member                                  |
| `WEB_URL`                | variable | both       | `https://staging.<domain>` / `https://<domain>` (the API load test calls it) |
| `LOAD_TEST_PASSWORD`     | secret   | api        | staging only, see `load-testing.md`                                          |
| `WEB_DOMAIN`             | variable | web        | staging only: the staging hostname to alias                                  |
| `VERCEL_ORG_ID`          | variable | web        | Vercel team ID                                                               |
| `VERCEL_PROJECT_ID`      | variable | web        | Vercel project ID                                                            |
| `VERCEL_TOKEN`           | secret   | web        | Vercel token scoped to the team                                              |

- [ ] frontend repository variable `API_REPOSITORY` (`<owner>/<api repository>`, and
      optionally `API_REF`), plus secret `API_REPO_TOKEN` if that repository is private: a
      fine-grained token with read-only access to its contents. CI uses them for the E2E run.
- [ ] Repository settings: Dependabot alerts and security updates on; dependency graph on.

### MongoDB Atlas

- [ ] Separate projects (or at least clusters) for staging and production. Staging holds only
      synthetic data (SRS 7.1).
- [ ] Database users with `readWrite` on the app database only, one per environment.
- [ ] Network access: Render's outbound IP ranges for the region, nothing else.
- [ ] Production: Continuous Cloud Backup on, 35-day retention (`database-restore.md`).
- [ ] Note the cluster region; it must match the privacy notice (NFR-PR5).

### Render

- [ ] New Blueprint from the api repository (`render.yaml`). It creates both API services, both
      cleanup jobs and the two environment groups, all with auto-deploy off.
- [ ] Fill every `sync: false` value in the environment groups from the secret manager:
      `MONGODB_URI`, `JWT_SECRET` (`openssl rand -base64 48`), `WEB_ORIGIN` (the web URL),
      `RESEND_API_KEY`, `EMAIL_FROM`, `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`.
- [ ] Health check path is `/readyz` (set by the blueprint).
- [ ] Optional: custom domain for the API. Browsers never call it directly (ADR-0002).

### Vercel

- [ ] Project linked to the frontend repository, root directory `/`. Git deployments
      are off (`vercel.json`), so only the pipeline deploys.
- [ ] Environment variables. **Preview** holds staging's values and **Production** holds
      production's: `API_INTERNAL_URL` (the Render URL), `APP_URL`, `NEXT_PUBLIC_APP_ENV`,
      `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`.
- [ ] Domains: production domain on Production; staging domain added to the project (the
      pipeline aliases it).

### Email

- [ ] Resend domain verified with SPF, DKIM and DMARC records (SRS 2.3, `EMAIL_FROM`).
      Separate API keys for staging and production, "sending access" only.

### First release only

- [ ] After the first production deploy, create the first admin (`admin-bootstrap.md`).
- [ ] Run the cleanup job once by hand (`scheduled-jobs.md`).

## Before approving production

- [ ] Staging smoke test green in the same run.
- [ ] No new errors in Sentry (staging) since the staging deploy.
- [ ] Any migration in the release is reversible, or has a documented plan and approval
      (SRS 10.2). `pnpm migrate status` lists what will run.
- [ ] The release notes list the requirement IDs delivered (SRS 12), and the load test ran if
      this is a major release (NFR-P6, `load-testing.md`).

## After a production deploy

- Keep the API Actions run open until the 30-minute watch passes.
- Watch error rate, p95 latency and failed logins on the dashboards for the same 30 minutes.
- Either fails: follow `rollback.md`.

## Deploying a specific commit

Run **Deploy** from the Actions tab of that repository (`workflow_dispatch`) with the commit
SHA. It still goes
through staging and the production approval. For an emergency rollback use `rollback.md`,
which is faster.
