# Runbook: rollback

Status: **manual**, target **under 15 minutes** for web and API (SRS 10.2).

Roll back when a release causes errors, a failed health watch, broken flows or a security
problem, and a fix-forward is not ready within the same 15 minutes. Declare an incident first
(`incident-response.md`) unless the rollback is routine and immediate.

## 1. Web app (Vercel), about 2 minutes

1. Vercel → project → **Deployments** → the previous production deployment → **Instant
   Rollback** (or **Promote to Production**).
2. CLI alternative: `vercel rollback <previous-deployment-url> --token=…`.
3. Instant Rollback serves the earlier build at once; nothing is rebuilt.

## 2. API (Render), about 5 minutes

1. Render → `linkpocket-api` → **Events** → the previous successful deploy → **Rollback**.
2. Render runs the earlier build and switches traffic once `/readyz` passes.
3. Repeat for `linkpocket-cleanup` if the job changed in the release.

Roll back the API before the web app when both changed, because the earlier web app may call
API behaviour the new API removed. Our API changes are additive within `/api/v1` (NFR-M6), so
order rarely matters.

## 3. Database migrations

Migrations are versioned and reversible (NFR-M5, ADR-0003). Every migration up to `0008` only
adds collections or indexes, which older code ignores, so a code rollback rarely needs a
migration rollback.

When a migration does have to be reverted:

1. Render → `linkpocket-api` → **Shell**.
2. `pnpm migrate:dist status`, to see what is applied.
3. `pnpm migrate:dist down --steps 1`, once per migration to revert.
   Rolling back never drops a collection that holds data.
4. If a run was interrupted and left the lock: `migrate:dist unlock`, then retry.

A migration that cannot be reversed needs a written plan and approval before it ships
(SRS 10.2); follow that plan instead of this section.

## 4. Verify, about 3 minutes

- [ ] `.github/scripts/smoke.sh https://<domain> <api-url>` passes.
- [ ] Sentry error rate back to its baseline; no new issues from the rolled-back release.
- [ ] Log in, open the library, save and delete a link on production with a test account.

## 5. Afterwards

- Revert or fix the change on `main` so the next release does not reintroduce it.
- Record the rollback in the incident log with timings (start, web done, API done, verified).
