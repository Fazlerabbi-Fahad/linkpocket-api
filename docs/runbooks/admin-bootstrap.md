# Runbook: create the first admin

Status: **manual** (a person runs it once per environment). SRS 2.3, FR-AD10.

The public signup flow can never create an admin. The bootstrap script promotes an account
that already exists. It never creates accounts and never handles passwords.

## Steps

- [ ] The future admin signs up at `/signup` with their own address and verifies it through
      the emailed link. Admins need a verified email like everyone else (FR-AD10).
- [ ] Set `ADMIN_BOOTSTRAP_EMAIL` to that address in the API's environment (secret manager or
      a local `.env`, never committed), with the usual `MONGODB_URI`, `JWT_SECRET` and
      `WEB_ORIGIN`.
- [ ] From the `api` folder, after `pnpm build`, run:

  ```bash
  pnpm admin:bootstrap
  ```

- [ ] Check the log. `promoted to admin` means the role was set. `already admin` means nothing
      changed. `no account with that email` exits with code 1: sign up first, then run it again.
- [ ] The admin opens `/admin`. An existing session picks up the role on its next request and,
      from then on, ends 24 hours after login (FR-A8).
- [ ] Remove `ADMIN_BOOTSTRAP_EMAIL` from the environment once the admin exists.

## Further admins and removing one

v1 has no screen for roles (OQ-39). Repeat the steps above to add an admin. To remove the role,
a database operator sets `role` back to `"user"` on that account. The role check runs on every
request (FR-AD2), so this takes effect on the next request.
