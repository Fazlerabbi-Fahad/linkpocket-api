# Runbook: scheduled jobs and scheduled job failure

Status: **manual setup required**. `render.yaml` defines the cron services, but they are
created and first run by hand. FR-A12, NFR-A5, NFR-O3, SRS 10.4 "scheduled job failure".

## Jobs

| Job                  | Requirement    | Command (from `api`, after `pnpm build`) | Schedule           | Render service                                               |
| -------------------- | -------------- | ---------------------------------------- | ------------------ | ------------------------------------------------------------ |
| `cleanup-unverified` | FR-A12, NFR-A5 | `pnpm job:cleanup-unverified`            | daily at 03:00 UTC | `linkpocket-cleanup` (staging: `linkpocket-cleanup-staging`) |

The job deletes accounts still unverified 7 days after signup, with their sessions. It is
idempotent: running it twice, or two runs overlapping, is safe.

## Setup checklist

- [ ] The Render Blueprint (`render.yaml`, see `deployment.md`) created both cron services with
      schedule `0 3 * * *` and the same environment group as the API. Values come from the
      secret manager, never from the repository (NFR-S13).
- [ ] Auto-deploy is off. The Deploy workflow moves the job to each released commit.
- [ ] Run it once by hand (Render → service → **Trigger Run**) and check the log line below.
- [ ] Alerts (NFR-O3, `observability.md`): a run exits non-zero, or no `job_completed` line
      for 48 hours.

## What a healthy run logs

```json
{
  "level": 30,
  "service": "linkpocket-api",
  "event": "job_completed",
  "job": "cleanup-unverified",
  "deleted": 3,
  "durationMs": 41
}
```

A failure logs `"event": "job_failed"` with the error class name and exits with code 1. No
email addresses or account IDs are ever logged (FR-A12, NFR-B6).

## When a run fails

Severity: **SEV4**. The only effect is that stale unverified accounts stay longer. Fix it
within a week to keep the 7-day retention promise (SRS 5.5).

1. **Read the failure.** Render → cron service → **Logs**: the `job_failed` line (its `err.type`)
   and the exit code. A run with no output at all usually means the build or start command
   failed. Check the service **Events**.
2. **Database first.** Most failures are connectivity problems:
   - Atlas status page and cluster health.
   - Atlas network access still lists Render's outbound IPs.
   - `MONGODB_URI` in the environment group is current; it may have been rotated
     (`secret-rotation.md`).
   - Is the API's `/readyz` reporting `"database": "ok"`? If not, this is an API incident.
     Follow `incident-response.md`.
3. **Code or migration mismatch.** If the job started failing right after a release, confirm
   the cron service runs the same commit as the API (Render → Events). Re-run the Deploy
   workflow's cron step, or roll the job back with the API (`rollback.md`).
4. **Re-run by hand** with **Trigger Run** once the cause is fixed. It is safe to re-run.
5. **Missed runs** need no catch-up. The next run deletes everything past the 7-day mark.
6. **Paused on purpose?** During a long email outage the job is suspended so new signups are
   not deleted before they can verify (`email-provider-outage.md`). Check before "fixing" a
   missing run.
7. Close the alert and note the cause in the incident log if it took more than a day.
