import { SESSION_LIMITS, TIMINGS, type UserRole } from '../../shared/index.js';
import type { Types } from 'mongoose';
import mongoose, { Schema, model, type HydratedDocument, type Model } from 'mongoose';

/**
 * Server-side session record (clarification 1, ADR-0001). The JWT carries sub, jti and
 * sessionVersion; this record is what logout (FR-A6) revokes.
 */
export interface AuthSession {
  userId: Types.ObjectId;
  jti: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  userAgent: string | null;
}

export type AuthSessionDocument = HydratedDocument<AuthSession>;

function truncateUserAgent(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.slice(0, SESSION_LIMITS.userAgentMax);
}

const sessionSchema = new Schema<AuthSession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    jti: { type: String, required: true, immutable: true, match: /^[A-Za-z0-9_-]{16,128}$/ },
    createdAt: { type: Date, required: true, immutable: true, default: () => new Date() },
    lastUsedAt: { type: Date, required: true, default: () => new Date() },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    userAgent: { type: String, default: null, set: truncateUserAgent },
  },
  { collection: 'sessions', strict: 'throw', versionKey: false },
);

// Index names and TTL must match migrations/0004-create-sessions.ts (see the drift test).
sessionSchema.index({ jti: 1 }, { name: 'jti_unique', unique: true });
sessionSchema.index({ userId: 1, createdAt: -1 }, { name: 'userId_createdAt' });
// Expired records (revoked or not) are removed by MongoDB once expiresAt passes.
sessionSchema.index({ expiresAt: 1 }, { name: 'expiresAt_ttl', expireAfterSeconds: 0 });

export const AuthSessionModel: Model<AuthSession> =
  (mongoose.models.AuthSession as Model<AuthSession> | undefined) ??
  model<AuthSession>('AuthSession', sessionSchema);

/**
 * FR-A8: a session expires after 7 days without use; admin sessions also end 24 hours
 * after login regardless of activity (clarification 5). Call on create and on each use.
 */
export function computeSessionExpiry(input: {
  createdAt: Date;
  lastUsedAt: Date;
  role: UserRole;
}): Date {
  const idleLimit = input.lastUsedAt.getTime() + TIMINGS.sessionIdleTimeoutMs;
  if (input.role !== 'admin') return new Date(idleLimit);
  const absoluteLimit = input.createdAt.getTime() + TIMINGS.adminSessionAbsoluteMs;
  return new Date(Math.min(idleLimit, absoluteLimit));
}

/** The record half of the auth check; the user half (status, sessionVersion) is Phase 3. */
export function isSessionUsable(
  session: Pick<AuthSession, 'revokedAt' | 'expiresAt'>,
  now: Date = new Date(),
): boolean {
  return session.revokedAt === null && session.expiresAt.getTime() > now.getTime();
}
