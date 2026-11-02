import { migration as createUsers } from './0001-create-users.js';
import { migration as createResources } from './0002-create-resources.js';
import { migration as createAuditLog } from './0003-create-audit-log.js';
import { migration as createSessions } from './0004-create-sessions.js';
import { migration as createLoginAttempts } from './0005-create-login-attempts.js';
import { migration as indexVerificationToken } from './0006-index-verification-token.js';
import { migration as createVerificationThrottles } from './0007-create-verification-throttles.js';
import { migration as indexResourcesCreatedAt } from './0008-index-resources-created-at.js';
import type { Migration } from './types.js';

/** Ordered registry. Append new migrations; never reorder, rename or edit merged ones. */
export const migrations: readonly Migration[] = [
  createUsers,
  createResources,
  createAuditLog,
  createSessions,
  createLoginAttempts,
  indexVerificationToken,
  createVerificationThrottles,
  indexResourcesCreatedAt,
];

export * from './runner.js';
export type * from './types.js';
