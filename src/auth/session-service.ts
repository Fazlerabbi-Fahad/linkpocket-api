import { TIMINGS } from '../shared/index.js';
import type { Types } from 'mongoose';
import {
  AuthSessionModel,
  UserModel,
  computeSessionExpiry,
  isSessionUsable,
  type AuthSession,
  type User,
} from '../db/models/index.js';
import type { Clock } from '../lib/clock.js';
import { randomToken } from '../lib/crypto.js';
import type { SessionTokens } from './session-tokens.js';

export type SessionUser = Omit<User, 'passwordHash' | 'emailVerificationTokenHash'> & {
  _id: Types.ObjectId;
};
export type SessionRecord = AuthSession & { _id: Types.ObjectId };

export interface IssuedSession {
  token: string;
  session: SessionRecord;
}

export type AuthenticationResult =
  | { status: 'ok'; user: SessionUser; session: SessionRecord; refreshedToken: string | null }
  | { status: 'invalid' }
  | { status: 'disabled' };

/**
 * Server-side sessions (ADR-0001). A request is authenticated only if the JWT is valid, the
 * user is active, the JWT's sessionVersion matches the user's, and the session record is
 * neither revoked nor expired.
 */
export class SessionService {
  constructor(
    private readonly tokens: SessionTokens,
    private readonly clock: Clock,
  ) {}

  async create(
    user: Pick<SessionUser, '_id' | 'role' | 'sessionVersion'>,
    userAgent: string | undefined,
  ): Promise<IssuedSession> {
    const now = this.clock.now();
    const expiresAt = computeSessionExpiry({ createdAt: now, lastUsedAt: now, role: user.role });
    const created = await AuthSessionModel.create({
      userId: user._id,
      jti: randomToken(32),
      createdAt: now,
      lastUsedAt: now,
      expiresAt,
      userAgent: userAgent ?? null,
    });
    const session = created.toObject() as SessionRecord;
    const token = await this.tokens.sign(
      { sub: user._id.toHexString(), jti: session.jti, sv: user.sessionVersion },
      now,
      expiresAt,
    );
    return { token, session };
  }

  async authenticate(token: string): Promise<AuthenticationResult> {
    const now = this.clock.now();
    const claims = await this.tokens.verify(token, now);
    if (!claims) return { status: 'invalid' };

    const user = await UserModel.findById(claims.sub).lean<SessionUser>();
    if (!user) return { status: 'invalid' };
    if (user.status !== 'active') return { status: 'disabled' }; // FR-A11
    if (claims.sv !== user.sessionVersion) return { status: 'invalid' }; // NFR-S3

    const session = await AuthSessionModel.findOne({
      jti: claims.jti,
      userId: user._id,
    }).lean<SessionRecord>();
    if (!session) return { status: 'invalid' };

    // Recompute with the current role, so a user promoted to admin gets the 24 h cap at once.
    const roleExpiry = computeSessionExpiry({ ...session, role: user.role });
    const expiresAt = roleExpiry < session.expiresAt ? roleExpiry : session.expiresAt;
    if (!isSessionUsable({ revokedAt: session.revokedAt, expiresAt }, now))
      return { status: 'invalid' };

    let refreshedToken: string | null = null;
    if (now.getTime() - session.lastUsedAt.getTime() >= TIMINGS.lastActiveUpdateIntervalMs) {
      // Sliding 7-day window (FR-A8, OQ-10), written at most once per hour.
      const nextExpiry = computeSessionExpiry({
        createdAt: session.createdAt,
        lastUsedAt: now,
        role: user.role,
      });
      await AuthSessionModel.updateOne(
        { _id: session._id },
        { $set: { lastUsedAt: now, expiresAt: nextExpiry } },
      );
      session.lastUsedAt = now;
      session.expiresAt = nextExpiry;
      refreshedToken = await this.tokens.sign(claims, now, nextExpiry);
    }
    await this.touchUserActivity(user, now);

    return { status: 'ok', user, session, refreshedToken };
  }

  /** Section 5.1: lastActiveAt is updated at most once per hour. */
  private async touchUserActivity(user: SessionUser, now: Date): Promise<void> {
    const threshold = new Date(now.getTime() - TIMINGS.lastActiveUpdateIntervalMs);
    if (user.lastActiveAt && user.lastActiveAt > threshold) return;
    await UserModel.updateOne(
      { _id: user._id, $or: [{ lastActiveAt: null }, { lastActiveAt: { $lte: threshold } }] },
      { $set: { lastActiveAt: now } },
    );
  }

  /** FR-A6: logout revokes this session record. */
  async revoke(token: string): Promise<void> {
    const claims = await this.tokens.verify(token, this.clock.now());
    if (!claims) return;
    await AuthSessionModel.updateOne(
      { jti: claims.jti, userId: claims.sub, revokedAt: null },
      { $set: { revokedAt: this.clock.now() } },
    );
  }

  /** Marks every open session of the user revoked (password change, disable). */
  async revokeAll(userId: Types.ObjectId): Promise<void> {
    await AuthSessionModel.updateMany(
      { userId, revokedAt: null },
      { $set: { revokedAt: this.clock.now() } },
    );
  }
}
