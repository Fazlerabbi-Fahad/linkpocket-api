# Data model

Source of truth: SRS Section 5, plus `sessions` from clarification 1 (ADR-0001). Collections
and indexes are created only by migrations (ADR-0003). Each model declares the same named
indexes, and `test/schema-drift.test.ts` checks that they match.

| Collection              | Model                       | File                                           | Migration                            |
| ----------------------- | --------------------------- | ---------------------------------------------- | ------------------------------------ |
| `users`                 | `UserModel`                 | `src/db/models/user.model.ts`                  | `0001-create-users`                  |
| `resources`             | `ResourceModel`             | `src/db/models/resource.model.ts`              | `0002-create-resources`              |
| `auditLog`              | `AuditLogModel`             | `src/db/models/audit-log.model.ts`             | `0003-create-audit-log`              |
| `sessions`              | `AuthSessionModel`          | `src/db/models/session.model.ts`               | `0004-create-sessions`               |
| `loginAttempts`         | `LoginAttemptModel`         | `src/db/models/login-attempt.model.ts`         | `0005-create-login-attempts`         |
| `verificationThrottles` | `VerificationThrottleModel` | `src/db/models/verification-throttle.model.ts` | `0007-create-verification-throttles` |

All models use `strict: 'throw'` (unknown fields are an error, which supports NFR-PR1 data
minimization) and `versionKey: false`. Limits come from `src/shared/constants.ts`, so
the API, the web forms and the database enforce the same numbers (NFR-S7).

## `users` (SRS 5.1)

| Field                         | Type                       | Constraints                                                 |
| ----------------------------- | -------------------------- | ----------------------------------------------------------- |
| `email`                       | string                     | required, lowercase, trimmed, max 254, unique               |
| `passwordHash`                | string                     | required, `select: false`, stripped from JSON               |
| `name`                        | string \| null             | max 100, default null                                       |
| `role`                        | `"user"` \| `"admin"`      | default `"user"`                                            |
| `status`                      | `"active"` \| `"disabled"` | default `"active"`                                          |
| `sessionVersion`              | integer ≥ 0                | default 0                                                   |
| `emailVerifiedAt`             | Date \| null               |                                                             |
| `emailVerificationTokenHash`  | string \| null             | 64 hex chars (SHA-256), `select: false`, stripped from JSON |
| `emailVerificationExpiresAt`  | Date \| null               | stripped from JSON                                          |
| `verificationEmailSentAt`     | Date[]                     | send times in the last hour; FR-A4 limit (ADR-0005)         |
| `privacyPolicyAcceptedAt`     | Date                       | required (NFR-PR4)                                          |
| `createdAt`                   | Date                       | required, immutable                                         |
| `lastLoginAt`, `lastActiveAt` | Date \| null               |                                                             |

Indexes: `email_unique` `{ email: 1 }` unique · `createdAt_desc` `{ createdAt: -1 }` ·
`lastActiveAt_desc` `{ lastActiveAt: -1 }` · `emailVerifiedAt_createdAt`
`{ emailVerifiedAt: 1, createdAt: 1 }` (also used by the FR-A12 cleanup job) ·
`emailVerificationTokenHash_unique` `{ emailVerificationTokenHash: 1 }` unique, partial (only
string values), added by migration 0006 so verify-email does not scan the collection.

The SRS lists no `updatedAt` for users, so there is none (OQ-15).

## `resources` (SRS 5.2)

| Field                    | Type         | Constraints                                                |
| ------------------------ | ------------ | ---------------------------------------------------------- |
| `userId`                 | ObjectId     | required, immutable (NFR-S4)                               |
| `url`                    | string       | required, `^https?://`, parses as an http(s) URL, max 2048 |
| `title`                  | string       | required, trimmed, 1 to 300                                |
| `note`                   | string       | max 1000, default `""`                                     |
| `tags`                   | string[]     | max 10; each lowercase, trimmed, 1 to 30                   |
| `isPinned`               | boolean      | default false                                              |
| `pinnedAt`               | Date \| null | set exactly when `isPinned` is true (validated)            |
| `createdAt`, `updatedAt` | Date         | Mongoose timestamps                                        |

Indexes: `library_order` `{ userId: 1, isPinned: -1, pinnedAt: -1, createdAt: -1 }` ·
`userId_tags` `{ userId: 1, tags: 1 }` · `userId_createdAt` `{ userId: 1, createdAt: -1 }` ·
`createdAt_desc` `{ createdAt: -1 }` (migration 0008, admin counts, OQ-7) ·
`resource_text` text on `title`, `note`, `tags`, `url`.

## `auditLog` (SRS 5.3)

| Field          | Type             | Constraints                                                                                                       |
| -------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `actorId`      | string           | ObjectId hex or `"system"` (clarification 3)                                                                      |
| `targetUserId` | ObjectId \| null |                                                                                                                   |
| `action`       | enum             | `user.disable`, `user.enable`, `user.delete`, `user.export`, `auth.login_failed_lockout`, `auth.password_changed` |
| `createdAt`    | Date             | required, immutable                                                                                               |

Index: `createdAt_ttl` `{ createdAt: -1 }` with `expireAfterSeconds: 31536000` (1 year,
NFR-B5). The model is append-only: update, replace and re-save operations throw.

## `sessions` (clarification 1, ADR-0001)

| Field        | Type           | Constraints                                                |
| ------------ | -------------- | ---------------------------------------------------------- |
| `userId`     | ObjectId       | required, immutable                                        |
| `jti`        | string         | required, immutable, 16 to 128 URL-safe characters, unique |
| `createdAt`  | Date           | login time, immutable                                      |
| `lastUsedAt` | Date           | required                                                   |
| `expiresAt`  | Date           | required; `computeSessionExpiry()` (FR-A8)                 |
| `revokedAt`  | Date \| null   | set on logout                                              |
| `userAgent`  | string \| null | truncated to 512 (OQ-4)                                    |

Indexes: `jti_unique` `{ jti: 1 }` unique · `userId_createdAt` `{ userId: 1, createdAt: -1 }` ·
`expiresAt_ttl` `{ expiresAt: 1 }` with `expireAfterSeconds: 0`.

## `loginAttempts` (FR-A9, OQ-9, ADR-0004)

| Field         | Type   | Constraints                                                               |
| ------------- | ------ | ------------------------------------------------------------------------- |
| `_id`         | string | SHA-256 hex of the normalized email (no plaintext address)                |
| `failures`    | Date[] | failed attempts inside the 15-minute window; cleared when the lock starts |
| `lockedUntil` | Date   | null                                                                      | lock end, 15 minutes after the 5th failure |
| `expiresAt`   | Date   | the later of `lockedUntil` and 15 minutes after the last failure          |

Index: `expiresAt_ttl` `{ expiresAt: 1 }` with `expireAfterSeconds: 0`. A successful login
deletes the record. The lock is enforced by comparing `lockedUntil` with the current time,
not by the TTL, because MongoDB removes expired documents only about once a minute.

## `verificationThrottles` (FR-A4, OQ-25, ADR-0005)

| Field       | Type   | Constraints                                                |
| ----------- | ------ | ---------------------------------------------------------- |
| `_id`       | string | SHA-256 hex of the normalized email (no plaintext address) |
| `sentAt`    | Date[] | resend requests in the last hour                           |
| `expiresAt` | Date   | one hour after the latest request                          |

Index: `expiresAt_ttl` `{ expiresAt: 1 }` with `expireAfterSeconds: 0`. Used only for addresses
without an unverified account, so resend is limited and answers the same way for every address
(NFR-S15). Unverified accounts are counted in `users.verificationEmailSentAt`.

## Internal collections

| Collection         | Purpose                                          |
| ------------------ | ------------------------------------------------ |
| `_migrations`      | IDs of applied migrations and when they ran      |
| `_migrations_lock` | single lock document held during a migration run |
