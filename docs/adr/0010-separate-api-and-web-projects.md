# ADR-0010: Keep the API and the web app in separate projects

- **Status:** Accepted
- **Date:** 2026-11-01
- **Deciders:** product owner, engineering
- **Requirements:** NFR-M2, NFR-M4, NFR-M6, NFR-S12, SRS 10.1. Replaces the pnpm workspace
  layout (`apps/api`, `apps/web`, `packages/shared`) used up to Phase 14.

## Context

The product owner asked for the Express API and the Next.js web app to be separate projects,
so each can be owned, versioned, reviewed and deployed on its own. Both used the
`@linkpocket/shared` workspace package: Zod schemas, types, limits, error codes and the error
scrubbing used for Sentry. The API is the single source of truth for the contract (NFR-M6).

## Decision

- Two repositories, kept on disk in one parent folder like the team's other projects:
  `lp/api` (Express, MongoDB, Render) and `lp/frontend` (Next.js, Vercel). The parent folder
  holds nothing else. Each has its own `package.json`, lockfile, ESLint,
  Prettier and TypeScript settings, CI, deploy workflows and `.env.example`.
- **Shared code is copied, not published.** The API keeps it in `src/shared/` (imported by
  relative path, so compiled output runs in Node) and the web app in `shared/` (imported as
  `@/shared`, with extensionless relative imports for the bundler). Both copies run the same
  shared tests. A contract change is made in both repositories with the same content.
- **The API ships first.** Changes within `/api/v1` stay backward compatible; the web app
  releases after the API it depends on is live (`docs/runbooks/deployment.md`).
- **The web E2E suite runs the real API.** Playwright starts `pnpm e2e:server` in the API
  project: `../api` locally, or `LINKPOCKET_API_DIR`. In CI the web workflow checks out the
  API repository as `api/` next to `frontend/` (`API_REPOSITORY`, `API_REF`, `API_REPO_TOKEN`).
- **Docs live in the api project** (SRS, ADRs, runbooks, traceability), because the API owns the
  contract and operations. The web README links to them.

## Alternatives considered

| Option                                      | Pros                            | Cons                                                        | Why not chosen                           |
| ------------------------------------------- | ------------------------------- | ----------------------------------------------------------- | ---------------------------------------- |
| Keep the monorepo                           | One change updates both; one CI | Not what was asked; coupled releases                        | Product owner decision                   |
| Shared code as a private npm package        | One copy; versioned contract    | A third repository, a registry and a token; slower changes  | More moving parts than v1 needs          |
| Generate the web types from an OpenAPI spec | Contract checked automatically  | Needs a spec kept in step with Zod; loses shared validation | The forms reuse the Zod schemas directly |

## Consequences

- **Positive:** independent ownership, CI and deploys; smaller installs; each project builds
  and tests on its own.
- **Negative:** the shared code exists twice and can drift; contract changes need two pull
  requests in the right order; the web E2E job needs read access to the API repository.
- **Follow-ups:** if the copies start to drift, move them to a private package (the second
  alternative). Until then, reviewers check that a shared change lands in both.

## Verification

- Both projects pass `pnpm check` and `pnpm build` on their own; the API also passes
  `pnpm smoke:dist`.
- The web Playwright suite (E2E and axe) runs against the API project checked out next to it,
  so a contract mismatch fails CI.
