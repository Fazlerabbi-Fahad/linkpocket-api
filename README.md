# LinkPocket API

The Express API behind LinkPocket, a calm personal library for the links you want to keep. It
serves `/api/v1` and stores data in MongoDB. The web app lives next to it in
`lp/frontend`, its own project and repository ([ADR-0010](docs/adr/0010-separate-api-and-web-projects.md)).

Requirements: [docs/SRS.md](docs/SRS.md) (v1.3). Status per requirement:
[docs/TRACEABILITY.md](docs/TRACEABILITY.md).

## Layout

| Path          | What                                                                 |
| ------------- | -------------------------------------------------------------------- |
| `src/`        | Express app, services, Mongoose models and migrations, jobs          |
| `src/shared/` | Zod schemas, types, limits and error codes (copied in ../frontend)   |
| `test/`       | Integration tests (in-memory MongoDB)                                |
| `scripts/`    | E2E server for the web project's Playwright suite, load-test seeding |
| `load/k6/`    | Load test (staging only)                                             |
| `docs/`       | SRS, ADRs, runbooks, traceability                                    |
| `render.yaml` | Render Blueprint: API and scheduled job                              |

## Requirements

Node 24 (`.nvmrc`) and pnpm 12 (`packageManager` in `package.json`). For local development,
a MongoDB replica set (transactions are used for account deletion).

## Commands

```bash
pnpm install
```

```bash
pnpm check
```

`pnpm check` runs Prettier, ESLint, TypeScript and the tests with coverage, the same steps as
CI. Tests use `mongodb-memory-server`; the first run downloads a MongoDB binary, and each run
needs about 500 MB free in the system temp folder.

### Run locally

Copy `.env.example` to `.env` and set `MONGODB_URI` and `JWT_SECRET`, then:

```bash
pnpm migrate up
```

```bash
pnpm dev
```

The API listens on `PORT` (default 4000). Create the first admin with
`pnpm admin:bootstrap:dev` ([runbook](docs/runbooks/admin-bootstrap.md)).

### Database migrations

```bash
pnpm migrate status
```

```bash
pnpm migrate down --steps 1
```

See [ADR-0003](docs/adr/0003-versioned-reversible-migrations.md). Rolling back never drops a
collection that holds data.

## Shared code

`src/shared/` is also in `../frontend` as `shared/`. Change both in the same way, release the
API first and keep `/api/v1` backward compatible
([deployment runbook](docs/runbooks/deployment.md#how-a-release-flows)).

## Secrets

Only `.env.example` with placeholders is committed. Real values live in a local `.env`
(git-ignored) and in Render's environment groups (NFR-S13).

## Operations

- Health: `GET /healthz` (liveness) and `GET /readyz` (database and email).
- Logs are JSON lines on stdout (pino) with request ID, route template, status and duration.
  They never contain passwords, tokens, cookies, URLs or emails (AC-21). Errors go to Sentry
  when `SENTRY_DSN` is set.
- Releases: a green CI run on `main` deploys to staging, then waits for approval before
  production, then watches health for 30 minutes. See
  [docs/runbooks/deployment.md](docs/runbooks/deployment.md).
- Load test (staging only): [docs/runbooks/load-testing.md](docs/runbooks/load-testing.md).
- All runbooks: [docs/runbooks/README.md](docs/runbooks/README.md). Pre-launch checklist:
  [docs/TRACEABILITY.md](docs/TRACEABILITY.md#pre-launch-checklist).
