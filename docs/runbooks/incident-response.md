# Runbook: incident response

Status: **manual**. SRS 10.3, NFR-O4, NFR-M8. Talking to users and stakeholders:
`incident-communication.md`.

## Severity

| Level    | Examples                                                                                                 | Response                                                                                                    |
| -------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **SEV1** | Outage of web or API; suspected **data exposure** (any user's links, emails, or secrets); data loss      | Page on-call now. Product owner told **within 1 hour**. Post-incident review starts within 5 business days. |
| **SEV2** | Major degradation: login or saving failing for many users, p95 well over target, email down over 4 hours | Respond **within 4 hours**. Product owner told the same day.                                                |
| **SEV3** | Partial or short degradation with a workaround (email delayed, one browser broken)                       | Normal backlog, this sprint.                                                                                |
| **SEV4** | Minor (cosmetic bug, a failed cleanup run)                                                               | Normal backlog.                                                                                             |

When unsure, pick the higher level. Lowering it later is cheap.

## Roles

- **Incident lead:** the on-call engineer who acknowledged the page. Decides and coordinates,
  and doesn't have to be the one typing.
- **Communications:** the product owner or a delegate. Sends updates (`incident-communication.md`).
- **Scribe:** keeps the timeline in the incident document (UTC timestamps).

For SEV1, the lead and communications are different people.

## Steps

1. **Acknowledge** the alert within 15 minutes (SEV1/SEV2). Open the incident document with
   the template at the bottom.
2. **Assess.** What is broken, for whom, and since when? Check:
   - `/healthz` and `/readyz` on the API;
   - Sentry: new issues and error rate;
   - logs: 5xx by `route`, `errorCode` spikes;
   - the latest deploy (Render Events, Vercel Deployments, the Deploy workflow);
   - Atlas, Render, Vercel and Resend status pages.
3. **Declare** a severity, post in the on-call channel, and start the communication cadence.
4. **Mitigate first, then fix.**
   - Bad release: `rollback.md`.
   - Database: `database-restore.md` (only for data loss or corruption).
   - Email: `email-provider-outage.md`.
   - Cleanup job: `scheduled-jobs.md`.
   - Abuse or attack: block at the edge (Vercel Firewall), or tighten `DEFAULT_RATE_LIMITS`
     in `src/config.ts` and release.
5. **Verify** with `smoke.sh` and the dashboards, then watch for 30 minutes.
6. **Resolve.** Send the final update and record the end time.
7. **Review.** For SEV1 and SEV2, a blameless review within 5 business days, with actions
   tracked as issues.

## Suspected data exposure (always SEV1)

Do these in parallel with the steps above:

- [ ] **Contain:** close the leaking path (roll back, disable the endpoint, suspend the service).
- [ ] **Rotate:** review every secret that could be affected and rotate as needed
      (`secret-rotation.md`). After a `JWT_SECRET` leak, also delete all sessions.
- [ ] **Review logs** (SRS 10.3) for the exposure window: unusual `route`/`userId` patterns, admin
      actions in `auditLog` (`user.disable`, `user.enable`, `user.export`, `user.delete`),
      login failures and lockouts, and requests to admin routes from non-admins (403s).
      Logs hold IDs only (NFR-B6), so this review is safe to share with the team.
- [ ] **Scope:** which users and which data. Keep the list of affected user IDs in the
      incident document, not in chat.
- [ ] **Notify:** the product owner within 1 hour. They decide, with legal advice, on
      regulator notification (for example GDPR's 72-hour window when personal data is
      involved) and on notifying users ("data exposure" template).
- [ ] **Preserve evidence:** export the relevant logs before the 30-day retention runs out
      (NFR-B5).

## Incident document template

```text
Title / Severity / Status (investigating | mitigated | resolved)
Lead / Communications / Scribe
Started (UTC) / Detected (UTC) / Mitigated (UTC) / Resolved (UTC)
Impact: who, what, how many
Timeline: UTC time, what happened, who did it
Root cause (after review)
What went well / what did not
Actions: issue link, owner, due date
```
