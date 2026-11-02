# ADR-0003: Own collections and indexes with a small in-repo migration runner

- **Status:** Accepted
- **Date:** 2026-11-01
- **Deciders:** Product and Engineering (Fahad)
- **Requirements:** NFR-M5, SRS 10.2, SRS 5.1 to 5.3, NFR-B5

## Context

NFR-M5 requires versioned, reversible migrations. SRS 10.2 requires a documented plan for any
migration that cannot be reversed. Mongoose builds indexes automatically by default
(`autoIndex`), which is not versioned, cannot be rolled back, and can block production
startup on large collections.

## Decision

- Mongoose connects with `autoIndex: false` and `autoCreate: false`
  (`apps/api/src/db/connection.ts`). Migrations are the only thing that create collections and
  indexes.
- Migrations live in `apps/api/src/db/migrations/NNNN-description.ts`, each exporting
  `{ id, description, up(db, log), down(db, log) }`, and are listed in order in
  `migrations/index.ts`. A merged migration is never edited; changes go in a new migration.
- The runner (`migrations/runner.ts`) records applied IDs in `_migrations`, refuses to run if
  the applied list is not a prefix of the registry (drift), and holds a lock document in
  `_migrations_lock` so two deploys cannot migrate at once.
- `up` and `down` are idempotent so a failed run can be retried.
- **Rollback never destroys data.** Reverting a "create collection" migration drops its
  indexes and drops the collection only if it is empty; otherwise it keeps the collection and
  logs a warning. Any future migration that transforms data must state in its file whether
  `down` loses information; if it does, it needs the plan and approval from SRS 10.2.
- Every model declares the same named indexes; `test/schema-drift.test.ts` fails if a model
  and the migrations disagree.
- Commands (from `apps/api`): `pnpm migrate status | up [--to id] | down [--steps n] | unlock`.

## Alternatives considered

| Option                               | Pros             | Cons                                                                                                                     | Why not chosen                                          |
| ------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `migrate-mongo`                      | Mature, familiar | JS config and file loading do not fit our strict TypeScript ESM setup well; harder to test against mongodb-memory-server | The custom runner is ~150 lines with full test coverage |
| Mongoose `autoIndex` / `syncIndexes` | Zero code        | Not versioned or reversible; `syncIndexes` drops unknown indexes                                                         | Fails NFR-M5                                            |

## Consequences

- **Positive:** schema changes are reviewed, ordered, reversible and tested; startup never
  builds indexes.
- **Negative:** we maintain the runner; deploys need a migrate step before the new API
  version starts (deployment runbook, Phase 13).

## Verification

`apps/api/src/db/migrations/runner.test.ts` (apply, revert, round trip, lock, drift, failure
handling, data-preserving rollback) and `apps/api/test/schema-drift.test.ts`.
