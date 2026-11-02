# ADR-0006: Resource and account API

- **Status:** Accepted
- **Date:** 2026-11-01
- **Deciders:** Product and Engineering
- **Requirements:** FR-R1 to FR-R7, FR-C1, FR-L1 to FR-L5, FR-U1 to FR-U3, FR-D1 to FR-D3, NFR-S4

## Context

Phases 5 and 6 add `/api/v1/resources` and `/api/v1/account`. MongoDB has no row-level
security, so ownership must hold in every query (SRS 5.4, NFR-S4), and another user's
resource must look exactly like a missing one (FR-R6, AC-8).

## Decision

1. **Ownership.** Routes pass `authOf(req).user._id` (the session user) to the services. Every
   query includes `userId`, and no endpoint accepts a `userId` from the client: the strict
   schemas reject it. Lookups by id use `{ _id, userId }`, so another user's resource, a
   missing id and a malformed id all produce the same 404 `NOT_FOUND`. The cross-user suite
   compares those responses field by field.
2. **URLs.** The shared `resourceUrlSchema` validates and normalizes the URL in the browser and
   the API (FR-U3). URL problems return 400 `INVALID_URL` with a `url` field error; other
   problems return `VALIDATION_FAILED`. The URL is stored as typed (trimmed, `https://`
   added if missing), per OQ-17.
3. **Duplicates (FR-R7)** are saved, and the create response says `duplicate: true`. The check
   compares WHATWG-normalized forms, so `example.com`, `https://Example.com` and
   `https://example.com/` count as the same link (OQ-29). It reads only the `url` field of
   the user's own resources (OQ-8).
4. **Pinning.** `PATCH { isPinned }` sets `pinnedAt` to the server time, or clears it.
   Pinning an already pinned resource keeps its original `pinnedAt`.
5. **Library order and pagination.** Sort `isPinned, pinnedAt, createdAt, _id`, all
   descending (FR-L1), with `_id` as the tie-breaker. Pages use a keyset cursor: the last
   item's sort key, base64url JSON, validated on the way in. It is not signed, because it
   only narrows a query that is always scoped to the caller. Pages hold 50 by default and
   at most 50 (FR-L5).
6. **Search (FR-L2, OQ-6)** is a case-insensitive substring match on title, URL, note and tags,
   with regex characters escaped and limited to the caller's resources. `git` finds
   `github`, which MongoDB's word-based text index cannot do. The SRS text index stays, so
   Phase 11 can measure both against AC-19. Tag filters use `$all` (AND, FR-L3).
7. **Export (FR-D1)** builds `{ format, version, exportedAt, account, resources }` field by
   field. It is served as an attachment with `no-store`, and validated in tests by a
   strict shared schema, so a secret field can never be added silently. Each export writes
   `user.export` to the audit log.
8. **Delete (FR-D2, FR-D3)** needs the password, checked under the FR-A9 lockout. The
   resources, sessions, user record and the `user.delete` audit entry (ids and time only)
   are written in one MongoDB transaction. The cookies are then cleared.

## Alternatives considered

| Option                      | Pros                     | Cons                                                   | Why not chosen                       |
| --------------------------- | ------------------------ | ------------------------------------------------------ | ------------------------------------ |
| 403 for others' resources   | Clearer to the requester | Confirms the id exists (FR-R6 forbids it)              | 404 for all                          |
| Offset pagination (`skip`)  | Simple                   | Skips or repeats items when pins change between pages  | Keyset cursor                        |
| `$text` search              | Uses the SRS index       | Whole stemmed words only; `git` misses `github`        | Substring match; revisit in Phase 11 |
| Store a canonical URL field | Indexable duplicate test | Field not in SRS 5.2 (NFR-PR1, OQ-29)                  | Compare on the fly within one user   |
| Soft delete, purged later   | Undo window              | More state; FR-D2 only needs completion within 30 days | Immediate delete in a transaction    |

## Consequences

- **Positive:** ownership comes from one source (the session) and is tested on every endpoint.
  Pagination is stable while items are pinned. Deletion is all or nothing.
- **Negative:** search and the duplicate check scan one user's resources. That is fine at the
  sizes in NFR-P2 (500 resources); Phase 11 and the Phase 14 load test confirm it.
- **Follow-ups:** the library UI (Phases 8 to 11) uses `duplicate` for the warning and
  `nextCursor` for "Load more".

## Verification

`apps/api/test/resources/resources.test.ts`, `apps/api/test/cross-user.test.ts` (AC-8),
`apps/api/test/account/account.test.ts` (AC-17, AC-18), and the AC-2 list in
`apps/api/test/auth/login-logout.test.ts`.
