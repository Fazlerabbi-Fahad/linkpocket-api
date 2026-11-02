# Bundled data

## common-passwords.txt

The 10,000 most common passwords, one per line, used by FR-A10 screening
(`src/auth/password-screening.ts`). Matching is case-insensitive.

- Source: SecLists, `Passwords/Common-Credentials/10k-most-common.txt`
  (https://github.com/danielmiessler/SecLists), MIT License.
- Fetched: 2026-11-01. Upstream file SHA-256:
  `68782d6a4a19a4768d5f15dd66bd534e7a33055cc755411e33f16d18c50fdcce`.
- Local changes: CR characters and blank lines removed.

Refresh by downloading the upstream file, checking it is plain ASCII text, and replacing this
file in a reviewed pull request.
