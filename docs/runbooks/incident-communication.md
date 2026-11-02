# Runbook: incident communication

Status: **manual**. SRS 10.3, SRS 10.4. Owner during an incident: the **communications** role
(`incident-response.md`).

## Who hears what, and when

| Audience                        | SEV1                                                                  | SEV2                           | SEV3 / SEV4      |
| ------------------------------- | --------------------------------------------------------------------- | ------------------------------ | ---------------- |
| On-call channel (team)          | At once, then every 30 min                                            | At once, then every 2 h        | Ticket only      |
| Product owner                   | Within 1 hour                                                         | Same day                       | Weekly summary   |
| Users (status notice or banner) | Within 1 hour, then every hour                                        | If over 1 hour, then every 2 h | Only if they ask |
| Affected users by email         | Data exposure: once facts are confirmed, as the product owner decides | No                             | No               |
| Regulators                      | Data exposure: product owner decides with legal advice                | No                             | No               |

Updates go out on schedule even when nothing has changed ("still investigating, next update
at …"). Times are UTC, and the local time is added for users.

## Rules

- Say what users notice and what they should do. Never speculate about the cause.
- Never include user emails, links, IDs or secrets in any update, ticket or channel.
- One source of truth: the incident document. Updates are copied from it.
- Send emails to users only from the product's own sender (`EMAIL_FROM`), through Resend.
  If Resend is the thing that is down, the status notice is the only user channel.

## Templates

### Investigating

> **LinkPocket: [saving links / signing in / the site] is having problems**
> Since [time UTC], some people can't [what]. Your saved links are safe. We're working on it and
> will post the next update by [time UTC].

### Degraded service (for example email)

> **Verification emails are delayed**
> Since [time UTC], new accounts may not receive their verification email. Everything else works
> as normal. Once it's fixed, use "Resend verification" on the verification page. Next update by
> [time UTC].

### Mitigated

> **Fixed, monitoring**
> [What] is working again since [time UTC]. We're watching closely. [If data may be missing:
> "Links saved between [time] and [time] may need to be saved again."]

### Resolved

> **Resolved**
> The problem with [what] from [start] to [end] UTC is resolved. [One sentence on the cause, in
> plain words.] We're sorry for the disruption.

### Data exposure (only after the product owner approves the wording)

> **Important: a security issue affecting your LinkPocket account**
> On [date], we found that [what data: for example "the titles of some saved links"] could have
> been seen by [whom] between [start] and [end] UTC. [What we did: fixed the cause, signed
> everyone out, rotated keys.] [What you should do, if anything.] We're sorry. Questions:
> [contact address].

## After the incident

- Link the final update in the incident document.
- For SEV1 and SEV2, share the post-incident review summary with the product owner.
