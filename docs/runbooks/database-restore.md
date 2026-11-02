# Runbook: database restore and quarterly drill

Status: **manual** (Atlas console). NFR-B1 (RPO 5 minutes), NFR-B2 (RTO 4 hours), NFR-B3
(35-day retention), NFR-B4 (quarterly drill), AC-22.

## Setup checklist (production cluster)

- [ ] Atlas → cluster → **Backup** → Continuous Cloud Backup **on** (point-in-time restore).
      This gives a restore point within the last minutes, which meets the 5-minute RPO.
- [ ] Snapshot and point-in-time window: **35 days**. Nothing kept longer, so data from deleted
      accounts leaves the backups within 35 days (NFR-B3).
- [ ] Backup storage in the same region as the cluster (NFR-PR5).
- [ ] Atlas alerts on "Backup failed" and "Restore failed" routed to on-call (NFR-O4).
- [ ] Only two named people hold the Atlas "Project Owner" role that allows restores.

## When to restore

Data loss or corruption that the application cannot repair: a bad migration, a mistaken bulk
delete, or a compromised database. Declare a SEV1 first (`incident-response.md`). An outage
where the data is intact does **not** need a restore.

## Restore (target: service back within 4 hours)

Always restore into a **new cluster** first. Never overwrite production until the copy is
checked.

1. **Stop writes** (0:00–0:10). Render → `linkpocket-api` → **Suspend**. Vercel keeps serving
   pages, and API calls fail with an error until the API is back. Suspend
   `linkpocket-cleanup` too.
2. **Save what happened after the restore point** (0:10–0:30). If the damaged database is still
   readable, export the audit entries for accounts deleted after the restore point:
   `db.auditLog.find({ action: 'user.delete', createdAt: { $gt: ISODate('<restore point>') } })`.
   Those accounts must stay deleted (FR-D3).
3. **Choose the restore point** just before the damage. Use the incident timeline, error
   spikes in Sentry and the `auditLog`.
4. **Restore** (0:30–2:30). Atlas → Backup → **Restore** → Point in Time → that time → target:
   a **new** cluster (`linkpocket-restore-<date>`), same tier and region.
5. **Check the copy** (2:30–3:00), in the Atlas shell on the new cluster:
   - `db.users.countDocuments()` and `db.resources.countDocuments()` are close to the last
     known values (the admin overview, or the Sentry and log timeline).
   - `db._migrations.find()` lists every migration in the release.
   - Spot-check one test account and its library.
6. **Re-apply deletions** from step 2. For each `targetUserId`, delete the user
   (`users._id`), their resources and their sessions (`userId`). Do the same for anything else the incident review requires.
7. **Switch** (3:00–3:30). Update `MONGODB_URI` in `linkpocket-production` to the new cluster
   (or, if policy requires the original cluster name, restore again onto it from the checked
   point). Resume the API and the cleanup job.
8. **Verify** (3:30–4:00). `smoke.sh` passes. Log in and save and delete a link with a test
   account. Check the admin overview counts.
9. Keep the damaged cluster for the investigation, then delete it within 35 days (NFR-B3).

Data written between the restore point and the suspension is lost (at most the RPO plus the
time to suspend). The incident communication says so (`incident-communication.md`).

## Quarterly drill (NFR-B4, AC-22)

Once a quarter, on staging data or on a production snapshot restored to an isolated cluster
that only the drill runner can reach:

1. Start a timer. Restore the latest point-in-time to a new scratch cluster (step 4 above).
2. Run the checks in step 5 against it.
3. Point a local API at it (`MONGODB_URI` in `api/.env`, `pnpm dev`) and run `pnpm migrate status`.
4. Stop the timer. **Pass:** total time under 4 hours (RTO) and the restore point within 5
   minutes of the requested time (RPO).
5. Delete the scratch cluster. Add a row to the drill log below.

### Drill log

| Date | Who | Restore point requested | Restore point achieved | Duration | Result | Notes |
| ---- | --- | ----------------------- | ---------------------- | -------- | ------ | ----- |
|      |     |                         |                        |          |        |       |
