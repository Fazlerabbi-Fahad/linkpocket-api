import { z } from 'zod';

export const USER_ROLES = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Section 5.3. Append only; never rename an action that has been written to the log. */
export const AUDIT_ACTIONS = [
  'user.disable',
  'user.enable',
  'user.delete',
  'user.export',
  'auth.login_failed_lockout',
  'auth.password_changed',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Clarification 3: auditLog.actorId is an ObjectId hex string or "system". */
export const SYSTEM_ACTOR = 'system';

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const auditActorIdSchema = z.union([objectIdSchema, z.literal(SYSTEM_ACTOR)]);

export function isObjectIdHex(value: string): boolean {
  return objectIdSchema.safeParse(value).success;
}

export function isAuditActorId(value: string): boolean {
  return auditActorIdSchema.safeParse(value).success;
}

/**
 * NFR-S6: true when any object key (at any depth) starts with "$". The API rejects such
 * input before it reaches Zod parsing or a Mongo query.
 */
export function hasMongoOperatorKeys(value: unknown, depth = 0): boolean {
  if (depth > 32) return true; // treat absurd nesting as hostile
  if (Array.isArray(value)) return value.some((item) => hasMongoOperatorKeys(item, depth + 1));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).some(
      ([key, child]) => key.startsWith('$') || hasMongoOperatorKeys(child, depth + 1),
    );
  }
  return false;
}
