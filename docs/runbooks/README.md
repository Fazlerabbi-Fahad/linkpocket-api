# Runbooks

SRS 10.4 requires these before launch: deployment, rollback, secret rotation, database
restore, email provider outage, scheduled job failure and incident communication. NFR-M8 also
requires incident response.

| Runbook                                                | Covers                                                  | Requirements                     |
| ------------------------------------------------------ | ------------------------------------------------------- | -------------------------------- |
| [deployment.md](deployment.md)                         | Release pipeline, one-time hosting setup, approval gate | SRS 10.1, NFR-M5, NFR-S13        |
| [rollback.md](rollback.md)                             | Web, API and migration rollback within 15 minutes       | SRS 10.2, NFR-M5                 |
| [secret-rotation.md](secret-rotation.md)               | `JWT_SECRET`, `RESEND_API_KEY` and the rest             | NFR-S13, SRS 10.3                |
| [database-restore.md](database-restore.md)             | Atlas point-in-time restore, quarterly drill            | NFR-B1 to NFR-B4, AC-22          |
| [email-provider-outage.md](email-provider-outage.md)   | Resend down, quota or configuration problems            | FR-A2, FR-A4, NFR-A2, NFR-A4     |
| [scheduled-jobs.md](scheduled-jobs.md)                 | Cleanup job setup and failure                           | FR-A12, NFR-A5, NFR-O3           |
| [incident-response.md](incident-response.md)           | Severities, roles, steps, data exposure                 | SRS 10.3, NFR-O4, NFR-M8         |
| [incident-communication.md](incident-communication.md) | Who to tell, when, and templates                        | SRS 10.3                         |
| [observability.md](observability.md)                   | Logs, Sentry, dashboards, alerts, uptime, on-call       | NFR-O1 to NFR-O4, NFR-A1, NFR-B5 |
| [load-testing.md](load-testing.md)                     | k6 on staging, performance checks                       | NFR-P1 to NFR-P6, AC-19          |
| [dependency-updates.md](dependency-updates.md)         | Monthly updates and advisories                          | NFR-M7, NFR-S12, AC-23           |
| [penetration-test.md](penetration-test.md)             | External test before launch                             | NFR-S18, AC-24                   |
| [admin-bootstrap.md](admin-bootstrap.md)               | Creating the first admin                                | SRS 2.3, FR-AD10                 |
