# LinkPocket: Software Requirements Specification (v1.3)

| Field | Value |
|---|---|
| Document ID | LP-SRS-001 |
| Version | 1.3 (Draft for approval) |
| Status | Draft |
| Owner | Fahad (Product and Engineering) |
| Classification | Internal |
| Last updated | 2026-10-31 |
| Review cycle | Every release, and at least quarterly |

### Revision History
| Version | Date | Change summary |
|---|---|---|
| 1.0 | 2026-10-29 | Initial SRS (React, Vite, Supabase). |
| 1.1 | 2026-10-30 | Stack changed to Next.js, Express, MongoDB. Admin panel added. |
| 1.2 | 2026-10-30 | Email verification required at signup. Admin area separated by role within the same Next.js app. |
| 1.3 | 2026-10-31 | Enterprise baseline: document control, traceability, security controls, data lifecycle, operational requirements, change control. Admin metrics limited to counts. |

### Approvals
| Role | Name | Decision | Date |
|---|---|---|---|
| Product owner | Fahad | Pending | |
| Engineering lead | Fahad | Pending | |
| Security review | Pending | Pending | |

---

## 1. Introduction

### 1.1 Purpose
This document specifies the functional, security, operational, and quality requirements for LinkPocket v1. It is the baseline for design, implementation, testing, and acceptance. Changes follow the process in Section 12.

### 1.2 Scope
**In scope for v1:**
- Accounts with required email verification
- Saving, editing, deleting, pinning, and searching resources
- Copy URL, QR code display, and open link actions
- Account deletion and personal data export
- Admin area with aggregate counts only
- Operational controls: logging, backups, monitoring, and incident response

**Out of scope for v1:** Sharing between users, browser extensions, mobile apps, password reset (v1.1), social login, SSO, multi-tenant organizations, admin access to users' resource content.

### 1.3 Definitions and Abbreviations
| Term | Definition |
|---|---|
| Resource | A saved web link and its metadata, owned by exactly one user. |
| Original URL | The webpage URL saved by the user. Never a LinkPocket record URL. |
| Pin | A flag that moves a resource to the top of the user's library. |
| Verified user | A user whose email address has been confirmed through a single-use link. |
| Admin | A user with `role = "admin"`. Has access to the admin area only. |
| Active user | A user whose `lastActiveAt` falls within the selected window. |
| PII | Personally identifiable information. In LinkPocket: email, name, IP address in logs. |
| RPO / RTO | Recovery Point Objective / Recovery Time Objective. |
| SLO | Service Level Objective. |
| ASVS | OWASP Application Security Verification Standard. |
| MUST / SHOULD / MAY | Requirement levels per RFC 2119. |

### 1.4 References
- OWASP ASVS 4.0.3, Level 2
- OWASP Top 10 (2021)
- OWASP Cheat Sheets: Session Management, Password Storage, CSRF Prevention
- GDPR Articles 5, 15, 17, 20, 32 (applied as the data protection baseline, regardless of user location)

---

## 2. Overall Description

### 2.1 Product Perspective
LinkPocket is a pnpm monorepo:
- **`apps/web`:** Next.js (App Router, TypeScript). Serves the user app at `/` and the admin area at `/admin`.
- **`apps/api`:** Express (TypeScript), REST API under `/api/v1`.
- **`packages/shared`:** Zod schemas, TypeScript types, and error codes shared by web and API.
- **Data:** MongoDB Atlas via Mongoose.
- **Email:** Resend (transactional only).

### 2.2 User Classes
| Class | Description | Access |
|---|---|---|
| Unverified user | Signed up, email not confirmed. | Verification and resend endpoints only. |
| Registered user | Verified. | Own resources, own account settings, data export, account deletion. |
| Admin | Verified, `role = "admin"`. | Aggregate counts, user account summaries, disable and enable accounts. No resource content. |

### 2.3 Assumptions and Dependencies
- Users have a modern browser with JavaScript and cookies enabled.
- MongoDB Atlas provides point-in-time backups.
- Resend provides transactional delivery with SPF, DKIM, and DMARC configured on the sending domain.
- Saved URLs point to public pages. Private pages still produce valid QR codes and links.
- The first admin is created by a seed script using `ADMIN_BOOTSTRAP_EMAIL`. The public signup flow cannot create admins.

### 2.4 Constraints
- The browser never connects to MongoDB or Resend directly.
- The API is the only component that reads or writes the database.
- QR codes are generated in the browser. No QR image is stored.
- Mobile-responsive layout is required.
- Secrets are never committed to source control.

---

## 3. Functional Requirements

Each requirement has a unique ID. Traceability to tests is in Section 13.

### 3.1 Authentication and Account Verification
| ID | Priority | Requirement |
|---|---|---|
| FR-A1 | MUST | Users sign up with email and password. |
| FR-A2 | MUST | Signup sends a verification email with a single-use link valid for 24 hours. |
| FR-A3 | MUST | Unverified users cannot access resources or account settings. They see a "Verify your email" screen with a resend action. |
| FR-A4 | MUST | Resend is limited to 1 per 60 seconds and 5 per hour per account. |
| FR-A5 | MUST | A valid verification link marks the account verified and starts a session. Expired, used, or invalid links show an error and a resend option. |
| FR-A6 | MUST | Users log in and log out. Logout invalidates the session cookie on the client and the server-side session record. |
| FR-A7 | MUST | Unauthenticated access to protected pages redirects to login, preserving the intended destination. |
| FR-A8 | MUST | Sessions expire after 7 days of inactivity and after 24 hours regardless of activity for admins. |
| FR-A9 | MUST | Five failed logins for an email within 15 minutes lock further attempts for that email for 15 minutes. |
| FR-A10 | MUST | Passwords are at least 8 characters and at most 128. Common-password and breached-password screening is applied. |
| FR-A11 | MUST | A disabled user cannot log in. Existing sessions stop working on the next request. |
| FR-A12 | MUST | Unverified accounts older than 7 days are deleted by a scheduled job, with a log entry containing a count only. |
| FR-A13 | SHOULD | Users can see their active sessions and sign out other sessions. Deferred to v1.1 if schedule is tight. |

### 3.2 Resource Management
| ID | Priority | Requirement |
|---|---|---|
| FR-R1 | MUST | Save a resource with URL (required), title (required), note (optional, max 1000 chars), tags (optional, max 10 tags, max 30 chars each, lowercase). |
| FR-R2 | MUST | A blank title defaults to the URL hostname. |
| FR-R3 | MUST | Edit any field of an owned resource. |
| FR-R4 | MUST | Delete an owned resource after a confirmation prompt. Deletion is permanent. |
| FR-R5 | MUST | Each resource displays its domain, saved date, and tags. |
| FR-R6 | MUST | Requests for another user's resource return 404, not 403. |
| FR-R7 | MUST | Saving a duplicate URL for the same user is allowed and produces a visible warning. |

### 3.3 Resource Card Actions
| ID | Priority | Requirement |
|---|---|---|
| FR-C1 | MUST | **Pin/Unpin** toggles `isPinned`. Icon state reflects status. |
| FR-C2 | MUST | **Copy URL** copies the original URL and shows "Link copied" for 2 seconds. If the Clipboard API is unavailable, show the URL in a selectable field in a modal. |
| FR-C3 | MUST | **Show QR code** opens a modal with a QR code encoding the original URL, the URL as text, and a Close button. |
| FR-C4 | SHOULD | **Download QR** saves the QR as PNG. |
| FR-C5 | MUST | **Open link** opens the original URL in a new tab with `rel="noopener noreferrer"`. |

### 3.4 Library Views
| ID | Priority | Requirement |
|---|---|---|
| FR-L1 | MUST | Order: pinned first (most recently pinned first), then newest saved. |
| FR-L2 | MUST | Search matches title, URL, note, and tags. Debounced at 300 ms. |
| FR-L3 | MUST | Filter by tag, with AND logic for multiple tags. |
| FR-L4 | MUST | Filter by pinned status. |
| FR-L5 | MUST | Paginated, 50 per page, "Load more". |
| FR-L6 | MUST | Empty states with a call to action. |

### 3.5 URL Validation
| ID | Priority | Requirement |
|---|---|---|
| FR-U1 | MUST | Accept only `http://` and `https://`. |
| FR-U2 | MUST | Trim input. If the scheme is missing, prepend `https://`. |
| FR-U3 | MUST | Invalid URLs show an inline error and block saving. Validation runs in the browser and the API. |

### 3.6 Account Data Rights
| ID | Priority | Requirement |
|---|---|---|
| FR-D1 | MUST | A user can export all their resources and account metadata as a JSON file, excluding password hashes and internal tokens. |
| FR-D2 | MUST | A user can delete their account. Deletion removes the user record and all resources, and is completed within 30 days. A confirmation step requires re-entering the password. |
| FR-D3 | MUST | Account deletion is written to the audit log with the user ID and timestamp, and no other personal data. |
| FR-D4 | MUST | Backups containing deleted data expire within the backup retention window (Section 4.3). |

### 3.7 Admin Area
The admin area is part of the same Next.js app, under `/admin`, with its own layout and navigation. It is not linked from the user interface.

| ID | Priority | Requirement |
|---|---|---|
| FR-AD1 | MUST | Only verified admins can access `/admin` and `/api/v1/admin/*`. Non-admins are redirected from `/admin` and receive 403 from the API. |
| FR-AD2 | MUST | Role checks happen on the server for every admin request. Client-side guards are convenience only. |
| FR-AD3 | MUST | Overview shows counts only: total users, verified, unverified, new users (today, 7 days, 30 days), active users (7 and 30 days), total resources, resources added (today, 7 days, 30 days), average resources per user, users with zero resources, total pinned resources. |
| FR-AD4 | MUST | Trend chart: daily new users and daily resources added for the last 30 days. |
| FR-AD5 | MUST | User list: email, name, signup date, verification status, last login, last active, resource count, status. Searchable by email, paginated at 25. |
| FR-AD6 | MUST | Admins can disable and re-enable accounts. Disabling does not delete data. |
| FR-AD7 | MUST | Admin responses never include resource URLs, titles, notes, or tags. |
| FR-AD8 | MUST | Disable and enable actions are recorded in the audit log with admin ID, target user ID, action, and timestamp. |
| FR-AD9 | MUST | Statistics are computed on page load. A refresh control is provided. |
| FR-AD10 | MUST | Admin accounts require the same verification as other users and re-authentication before disabling another account. |

---

## 4. Non-Functional Requirements

### 4.1 Performance and Capacity
| ID | Requirement |
|---|---|
| NFR-P1 | Library loads within 2 seconds (p95) on a 4G connection for up to 500 resources. |
| NFR-P2 | Search returns results within 300 ms (p95) for libraries of 500 resources. |
| NFR-P3 | QR generation completes within 200 ms for URLs up to 2,048 characters. |
| NFR-P4 | Admin overview loads within 2 seconds (p95) at 10,000 users and 500,000 resources. |
| NFR-P5 | API p95 latency under 300 ms for resource endpoints at 200 concurrent users. |
| NFR-P6 | Load tests run before each major release and must pass these targets. |

### 4.2 Availability and Reliability
| ID | Requirement |
|---|---|
| NFR-A1 | Target availability of 99.5% monthly for the web app and API, excluding announced maintenance. |
| NFR-A2 | Health endpoints `/healthz` (liveness) and `/readyz` (database and email dependency checks) are exposed. |
| NFR-A3 | Failed saves show a retry option and never silently drop user input. Input is kept in the form until the save succeeds. |
| NFR-A4 | Email send failures are retried with exponential backoff, up to 3 attempts, then logged. |
| NFR-A5 | Scheduled jobs are idempotent and safe to run more than once. |

### 4.3 Backup, Recovery, and Data Retention
| ID | Requirement |
|---|---|
| NFR-B1 | RPO: 5 minutes, using MongoDB Atlas continuous backup. |
| NFR-B2 | RTO: 4 hours for full service restoration. |
| NFR-B3 | Backups are retained for 35 days. Deleted-user data is purged from backups within that window. |
| NFR-B4 | A restore drill is performed and documented once per quarter. |
| NFR-B5 | Audit logs are retained for 1 year. Application logs are retained for 30 days. |
| NFR-B6 | Logs never contain passwords, tokens, cookies, or full resource URLs. Log entries that need an identifier use the user ID. |

### 4.4 Security
Controls are mapped to OWASP ASVS Level 2 where applicable.

| ID | ASVS area | Requirement |
|---|---|---|
| NFR-S1 | V2 Authentication | Passwords hashed with bcrypt, cost factor 12, or Argon2id if the platform supports it. |
| NFR-S2 | V3 Session | Session tokens are JWTs in `httpOnly`, `Secure`, `SameSite=Lax` cookies. Tokens are never stored in `localStorage` or `sessionStorage`. |
| NFR-S3 | V3 Session | Session records are server-revocable. A `sessionVersion` on the user is incremented on password change, disable, or logout-all. |
| NFR-S4 | V4 Access control | Every resource query filters by `req.user._id` on the server. The client never supplies `userId`. |
| NFR-S5 | V4 Access control | Admin endpoints require `role === "admin"` and verified status on every request. |
| NFR-S6 | V5 Validation | All input is validated with Zod at the API boundary. Mongo operators (`$`-prefixed keys) in input are rejected. |
| NFR-S7 | V5 Validation | Request body limit of 100 KB. Array and string length limits match the data model. |
| NFR-S8 | V7 Error handling | Errors return a generic message and a `requestId`. Stack traces are never returned to clients. |
| NFR-S9 | V8 Data protection | Verification tokens are random (at least 32 bytes) and stored only as SHA-256 hashes. Comparisons are constant-time. |
| NFR-S10 | V13 API | CSRF protection on all state-changing requests: double-submit token in a header, in addition to `SameSite=Lax`. |
| NFR-S11 | V14 Configuration | `helmet` with a strict Content Security Policy for the web app. CORS allows only `WEB_ORIGIN`. |
| NFR-S12 | V14 Configuration | Dependencies are scanned in CI (`pnpm audit` and a software composition analysis tool). High or critical findings block release. |
| NFR-S13 | V14 Configuration | Secrets are stored in the hosting provider's secret manager. Rotation procedure documented for `JWT_SECRET` and `RESEND_API_KEY`. |
| NFR-S14 | Abuse | Rate limits on login, signup, resend verification, and all admin endpoints. |
| NFR-S15 | Abuse | Signup and resend return identical responses for new and existing addresses. |
| NFR-S16 | Output | All user-generated text is rendered through React escaping. No `dangerouslySetInnerHTML` for user content. |
| NFR-S17 | Output | Links open with `rel="noopener noreferrer"`. Only `http` and `https` URLs are rendered as clickable links. |
| NFR-S18 | Penetration testing | An external penetration test is completed before public launch. Critical and high findings are fixed before release. |

### 4.5 Privacy
| ID | Requirement |
|---|---|
| NFR-PR1 | Data minimization: the system stores only email, optional name, password hash, timestamps, and resource data needed for the features above. |
| NFR-PR2 | The QR code contains only the original URL, never account or library identifiers. |
| NFR-PR3 | Admin endpoints return aggregate counts and account metadata only. No resource content. |
| NFR-PR4 | A privacy notice is shown at signup, linking to the policy. Consent to the policy is recorded with the timestamp. |
| NFR-PR5 | Personal data is processed in the region of the MongoDB Atlas cluster. The region is documented in the privacy notice. |

### 4.6 Accessibility, Usability, and Compatibility
| ID | Requirement |
|---|---|
| NFR-U1 | WCAG 2.1 Level AA. All icon buttons have `aria-label`s. |
| NFR-U2 | Fully keyboard operable, with visible focus indicators. |
| NFR-U3 | Responsive from 360 px to desktop widths. |
| NFR-U4 | Latest two versions of Chrome, Edge, Firefox, and Safari. |
| NFR-U5 | Automated accessibility scan in CI with no critical violations. |

### 4.7 Observability
| ID | Requirement |
|---|---|
| NFR-O1 | Structured JSON logs (pino) with request ID, method, route template, status, and duration. |
| NFR-O2 | Error tracking with source maps for web and API. |
| NFR-O3 | Dashboards and alerts for error rate, p95 latency, failed logins, email failures, and scheduled job outcomes. |
| NFR-O4 | Alerts route to the on-call channel. Severity levels: SEV1 (outage or data exposure) through SEV4 (minor). |

### 4.8 Maintainability
| ID | Requirement |
|---|---|
| NFR-M1 | TypeScript strict mode in all packages. |
| NFR-M2 | ESLint and Prettier enforced in CI. |
| NFR-M3 | Unit test coverage at least 80% for `packages/shared` and API service layers. |
| NFR-M4 | Architecture decisions recorded as ADRs in `/docs/adr`. |
| NFR-M5 | Database migrations are versioned and reversible. |
| NFR-M6 | API changes are versioned under `/api/v1`. Breaking changes require `/api/v2`. |
| NFR-M7 | Dependencies are updated at least monthly. Major upgrades go through an ADR. |
| NFR-M8 | Runbooks exist for deployment, rollback, secret rotation, restore, and incident response. |

---

## 5. Data Model (MongoDB)

### 5.1 Collection: `users`
| Field | Type | Constraints |
|---|---|---|
| `_id` | ObjectId | PK |
| `email` | string | Required, unique, lowercase, trimmed, max 254 chars |
| `passwordHash` | string | Required. Never returned by any API. |
| `name` | string | Optional, max 100 chars |
| `role` | string | `"user"` or `"admin"`, default `"user"` |
| `status` | string | `"active"` or `"disabled"`, default `"active"` |
| `sessionVersion` | number | Default 0. Incremented to revoke sessions. |
| `emailVerifiedAt` | Date | Nullable |
| `emailVerificationTokenHash` | string | Nullable. Cleared after use. |
| `emailVerificationExpiresAt` | Date | Nullable |
| `verificationEmailSentAt` | [Date] | Recent send timestamps, pruned after 1 hour |
| `privacyPolicyAcceptedAt` | Date | Required |
| `createdAt` | Date | Required |
| `lastLoginAt` | Date | Nullable |
| `lastActiveAt` | Date | Nullable. Updated at most once per hour. |

**Indexes:** unique `{ email: 1 }`; `{ createdAt: -1 }`; `{ lastActiveAt: -1 }`; `{ emailVerifiedAt: 1, createdAt: 1 }`.

### 5.2 Collection: `resources`
| Field | Type | Constraints |
|---|---|---|
| `_id` | ObjectId | PK |
| `userId` | ObjectId | Required, ref `users` |
| `url` | string | Required, `^https?://`, max 2048 chars |
| `title` | string | Required, max 300 chars |
| `note` | string | Optional, max 1000 chars |
| `tags` | string[] | Max 10, each max 30 chars, lowercase |
| `isPinned` | boolean | Required, default `false` |
| `pinnedAt` | Date | Nullable |
| `createdAt` | Date | Required |
| `updatedAt` | Date | Required |

**Indexes:**
- `{ userId: 1, isPinned: -1, pinnedAt: -1, createdAt: -1 }` (library list)
- `{ userId: 1, tags: 1 }` (tag filter)
- `{ userId: 1, createdAt: -1 }` (admin counts and trends)
- Text index on `title`, `note`, `tags`, `url` (search)

### 5.3 Collection: `auditLog`
| Field | Type | Constraints |
|---|---|---|
| `_id` | ObjectId | PK |
| `actorId` | ObjectId | Required. The admin, the user, or `"system"`. |
| `targetUserId` | ObjectId | Nullable |
| `action` | string | One of `user.disable`, `user.enable`, `user.delete`, `user.export`, `auth.login_failed_lockout`, `auth.password_changed` |
| `createdAt` | Date | Required. Retained 1 year (NFR-B5). |

**Index:** `{ createdAt: -1 }`, TTL index for 1 year.

### 5.4 Access Control
MongoDB has no row-level security, so ownership is enforced in the API:
- Auth middleware verifies the JWT, loads the user, and checks `status`, `emailVerifiedAt`, and `sessionVersion`.
- Resource services take `userId` only from `req.user`.
- `requireAdmin` middleware checks role and verification on every request.
- Integration tests cover cross-user access for every resource and admin endpoint.

### 5.5 Data Lifecycle
| Data | Retention | Deletion trigger |
|---|---|---|
| User account and resources | Until deleted by user or admin-initiated closure | FR-D2 |
| Unverified accounts | 7 days | FR-A12 (scheduled job) |
| Audit log | 1 year | TTL index |
| Application logs | 30 days | Log platform policy |
| Backups | 35 days | Atlas policy (NFR-B3) |

---

## 6. API Specification (Express, `/api/v1`)

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/auth/signup` | Create account, send verification | Public, rate-limited |
| POST | `/auth/verify-email` | Verify token, start session | Public |
| POST | `/auth/resend-verification` | Resend verification | Public, rate-limited |
| POST | `/auth/login` | Log in, set cookie | Public, rate-limited |
| POST | `/auth/logout` | End session | User |
| GET | `/auth/me` | Current user | User |
| POST | `/auth/change-password` | Change password, revoke other sessions | Verified user |
| GET | `/account/export` | Download JSON export | Verified user |
| DELETE | `/account` | Delete account (requires password) | Verified user |
| GET | `/resources` | List with `q`, `tag`, `pinned`, `cursor`, `limit` | Verified user |
| POST | `/resources` | Create | Verified user |
| GET | `/resources/:id` | Get one | Verified user |
| PATCH | `/resources/:id` | Update, including `isPinned` | Verified user |
| DELETE | `/resources/:id` | Delete | Verified user |
| GET | `/admin/stats` | Overview counts and trends | Admin |
| GET | `/admin/users` | Paginated user list, `q` search | Admin |
| PATCH | `/admin/users/:id/status` | Disable or enable | Admin, re-authentication |
| GET | `/healthz` | Liveness | Public |
| GET | `/readyz` | Readiness (DB, email) | Internal |

**Conventions:**
- Pinning uses `PATCH /resources/:id` with `{ "isPinned": true }`. The server sets or clears `pinnedAt`.
- Errors: `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`. Codes are defined in `packages/shared`.
- `POST /auth/signup` and `POST /auth/resend-verification` return identical responses for new and existing addresses.
- Every state-changing request requires the CSRF header (NFR-S10).

---

## 7. Technology Stack

| Layer | Choice | Rationale |
|---|---|---|
| Web | Next.js (App Router, TypeScript) | Single app for user and admin areas, role-gated routes. |
| Styling | Tailwind CSS, shadcn/ui | Accessible base components. |
| Client data | TanStack Query | Caching, optimistic pin toggles, retry. |
| Forms | React Hook Form + Zod resolvers | Shared validation with the API. |
| Charts | Recharts | Admin trend charts. |
| API | Express (TypeScript) | Explicit API layer with mature middleware. |
| Validation | Zod (shared package) | One schema for browser and server. |
| Auth | JWT in httpOnly cookies, bcrypt | Stateless sessions with server-side revocation via `sessionVersion`. |
| Email | Resend, React Email templates | Transactional delivery, testable templates. |
| Security | helmet, cors, express-rate-limit, csurf-style double-submit token | ASVS controls in Section 4.4. |
| Database | MongoDB Atlas, Mongoose | Document model, schemas, indexes, PITR backups. |
| Jobs | node-cron or Render cron job | Idempotent cleanup. |
| QR | `qrcode` | Client-side generation. |
| Icons | Lucide React | Consistent iconography. |
| Logging | pino, pino-http | Structured logs, request IDs. |
| Errors | Sentry (web and API) | Error tracking with source maps. |
| Testing | Vitest, Supertest, mongodb-memory-server, Playwright, axe-core | Unit, integration, end-to-end, accessibility. |
| Load testing | k6 | Performance targets in NFR-P5 and NFR-P6. |
| Monorepo | pnpm workspaces | Shared packages. |
| Hosting | Vercel (web), Render or Railway (API), MongoDB Atlas | Long-running API server. |
| CI/CD | GitHub Actions: lint, typecheck, test, audit, build, deploy with approval | Gated releases. |
| Secrets | Hosting provider secret manager | No secrets in source control. |

### 7.1 Environments
| Environment | Purpose | Data |
|---|---|---|
| Local | Development | Seeded fixtures |
| Staging | Pre-release verification, including load and accessibility tests | Anonymized or synthetic |
| Production | Live | Real |

### 7.2 Architecture Overview
```
Browser (Next.js)
  ├── /        user app (verified users)
  └── /admin   admin area (admin role)
  │ HTTPS, httpOnly cookie, CSRF header
  ▼
Express API (/api/v1)
  ├── Security middleware (helmet, CORS, rate limits, body limits)
  ├── Auth middleware (JWT, status, verification, sessionVersion)
  ├── Admin middleware (role)
  ├── Zod validation (shared)
  ├── Email service (Resend)
  ├── Scheduled jobs (unverified cleanup)
  └── Mongoose ──► MongoDB Atlas (users, resources, auditLog)
                     └── continuous backup (PITR, 35 days)
Observability: pino logs, Sentry, dashboards and alerts
```

### 7.3 Environment Variables
**Web:** `NEXT_PUBLIC_API_URL`, `APP_URL`
**API:** `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `WEB_ORIGIN`, `NODE_ENV`, `ADMIN_BOOTSTRAP_EMAIL`, `RESEND_API_KEY`, `EMAIL_FROM`, `SENTRY_DSN`, `LOG_LEVEL`

---

## 8. Acceptance Criteria

| ID | Criterion | Verified by |
|---|---|---|
| AC-1 | A new user signs up, verifies by email link, saves a link, sees it in the library, and logs out. | E2E |
| AC-2 | An unverified user cannot access any resource or account endpoint. | API integration |
| AC-3 | A verification link works once. Reuse or use after 24 hours shows an error and a resend option. | API integration, E2E |
| AC-4 | Resend is blocked after the rate limit. | API integration |
| AC-5 | Pinning moves a resource to the top. Unpinning restores chronological order. | E2E |
| AC-6 | Copy URL places the exact original URL on the clipboard. | E2E |
| AC-7 | The QR code decodes to the original URL. | Unit (decode test) |
| AC-8 | Another user's resource ID returns 404 on every resource endpoint. | API integration |
| AC-9 | Non-http(s) URLs are rejected by the browser and the API. | Unit, API integration |
| AC-10 | A non-admin visiting `/admin` is redirected, and `/api/v1/admin/*` returns 403. | E2E, API integration |
| AC-11 | Admin overview counts match a seeded dataset. | Integration |
| AC-12 | Admin responses contain no resource URLs, titles, notes, or tags. | API contract test |
| AC-13 | A disabled user cannot log in, and existing sessions stop working on the next request. | API integration |
| AC-14 | Signup and resend responses are identical for new and existing addresses. | API integration |
| AC-15 | Login lockout activates after 5 failures and clears after 15 minutes. | API integration |
| AC-16 | Password change revokes other sessions. | API integration |
| AC-17 | A user can export their data, and the export contains no password hash or tokens. | API integration |
| AC-18 | Account deletion removes the user and all resources, and writes an audit entry. | API integration |
| AC-19 | Search returns within 300 ms (p95) for 500 resources. | Load test (k6) |
| AC-20 | Accessibility scan has no critical violations. Keyboard-only flows complete. | axe-core, manual |
| AC-21 | Logs contain no passwords, tokens, cookies, or full resource URLs. | Log audit test |
| AC-22 | Restore drill completes within the RTO. | Quarterly drill |
| AC-23 | No high or critical dependency findings at release. | CI |
| AC-24 | Penetration test has no open critical or high findings at launch. | External pen test |

---

## 9. Out of Scope (v1)

- Sharing resources or public pages
- Browser extension and mobile app
- Password reset (v1.1)
- Social login and SSO
- Multi-tenant organizations and team accounts
- Automatic page metadata fetching
- Import and export of bookmarks in browser formats
- Link health checks and archival snapshots
- Admin access to any user's resource content
- Server-side QR image generation or storage

---

## 10. Operational Requirements

### 10.1 Release Process
1. Feature branches merge through pull requests with at least one reviewer.
2. CI must pass: lint, typecheck, unit, integration, E2E, accessibility, dependency audit, build.
3. Staging deployment and smoke test.
4. Production deployment with a manual approval gate.
5. Post-deploy health checks and error-rate watch for 30 minutes.

### 10.2 Rollback
- Web and API roll back to the previous build within 15 minutes.
- Database migrations are reversible (NFR-M5). A migration that cannot be reversed requires a documented plan and approval.

### 10.3 Incident Response
- SEV1 (outage or data exposure): page on-call, notify the product owner within 1 hour, and start a post-incident review within 5 business days.
- SEV2 (major degradation): respond within 4 hours.
- SEV3 and SEV4: handled in the normal backlog.
- Suspected data exposure triggers an immediate secret rotation review and a log review.

### 10.4 Runbooks
Required before launch: deployment, rollback, secret rotation, database restore, email provider outage, scheduled job failure, incident communication.

---

## 11. Build Order

1. Monorepo, shared package, CI skeleton, ADR template
2. MongoDB models and indexes with migrations
3. Auth API: signup, login, logout, `me`, cookies, `sessionVersion`, rate limits, CSRF
4. Email verification: token handling, Resend, verify and resend endpoints, cleanup job
5. Resource API with ownership integration tests
6. Account API: change password, export, delete, with audit entries
7. Web auth pages, verification screen, protected routes
8. Save, edit, delete with validation
9. Library list with pinning and pagination
10. Copy, open link, QR modal (Download QR as P2)
11. Search and tag filters
12. Admin API and role-tested admin area under `/admin`
13. Observability, dashboards, alerts, and runbooks
14. Accessibility pass, load test, pen test, staging sign-off, production release

---

## 12. Change Control
- Every change to this document increments the version and adds a revision history row.
- Requirements changes need product owner approval. Security-related changes need security review.
- Requirement IDs are never reused. Removed requirements are marked "Withdrawn" with the version in which they were removed.
- Each release records which requirement IDs it delivers.

---

## 13. Traceability Summary

| Area | Requirements | Acceptance criteria |
|---|---|---|
| Authentication and verification | FR-A1–A13 | AC-2, AC-3, AC-4, AC-13, AC-14, AC-15, AC-16 |
| Resources | FR-R1–R7 | AC-1, AC-8 |
| Card actions | FR-C1–C5 | AC-5, AC-6, AC-7 |
| Library | FR-L1–L6 | AC-5, AC-19 |
| URL validation | FR-U1–U3 | AC-9 |
| Account data rights | FR-D1–D4 | AC-17, AC-18 |
| Admin | FR-AD1–AD10 | AC-10, AC-11, AC-12 |
| Security | NFR-S1–S18 | AC-8, AC-10, AC-21, AC-23, AC-24 |
| Performance | NFR-P1–P6 | AC-19 |
| Availability and recovery | NFR-A1–A5, B1–B6 | AC-22 |
| Accessibility | NFR-U1–U5 | AC-20 |

---

## 14. Open Decisions

| # | Item | Proposed default |
|---|---|---|
| 1 | Admin-initiated account closure (beyond disable) | Not in v1. Disable only. |
| 2 | Session list and sign-out-other-devices (FR-A13) | Include only if schedule allows; otherwise v1.1. |
| 3 | Privacy policy and terms | Required before public launch. Drafting owner to be assigned. |
| 4 | Penetration test vendor | To be selected before staging sign-off. |
| 5 | Atlas region | Choose the region closest to primary users. |

**Defaults chosen in v1.2 that remain in effect:** unverified accounts deleted after 7 days; verification links expire after 24 hours; resends limited to 1 per minute and 5 per hour; Resend as the email provider.
