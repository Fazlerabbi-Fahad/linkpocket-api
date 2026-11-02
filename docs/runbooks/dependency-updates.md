# Runbook: dependency updates

Status: **manual routine, monthly** (NFR-M7). Supported by Dependabot (`.github/dependabot.yml`)
and the CI gates for NFR-S12 and AC-23.

## Every month

1. Merge Dependabot's grouped minor and patch pull request once CI is green. CI includes the
   E2E and accessibility suites, `pnpm audit` and dependency review.
2. For each **major** upgrade Dependabot proposes:
   - Read the changelog and migration guide.
   - Write a short ADR (`docs/adr/0000-template.md`): what changes, the risk, the test plan.
     NFR-M7 requires one.
   - Upgrade on a branch, then run `pnpm check`, `pnpm build` and the Playwright suite.
3. Run `pnpm outdated -r` to catch anything Dependabot skipped (for example a pinned
   TypeScript; see OQ-5).
4. Run `pnpm audit --audit-level high`. It must report nothing at high or critical (AC-23).

## When an advisory lands between routines

- High or critical: patch within 7 days (2 days if it is exploitable in how we use the
  package). CI blocks releases until it is fixed.
- Moderate or low: the next monthly routine.
- If no fixed version exists, assess reachability and document the decision in
  `docs/OPEN-QUESTIONS.md`. A `pnpm.overrides` entry or a replacement are the usual fixes.

## Supply-chain rules (already enforced)

- New dependency versions must have been published for pnpm's minimum release age before they
  install (exceptions are listed under `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`).
- Install scripts are denied unless listed in `allowBuilds`.
- The lockfile is frozen in CI (`--frozen-lockfile`).
