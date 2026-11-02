import type { ChangePasswordBody, CurrentUser, LoginBody, SignupBody } from '../shared/index.js';
import { AuditLogModel, UserModel } from '../db/models/index.js';
import { AppError } from '../lib/app-error.js';
import type { Clock } from '../lib/clock.js';
import type { EmailVerificationService } from './email-verification.js';
import type { LoginLockout } from './login-lockout.js';
import type { PasswordHasher } from './password-hasher.js';
import type { PasswordScreener } from './password-screening.js';
import type { IssuedSession, SessionService, SessionUser } from './session-service.js';

export interface AuthServiceDeps {
  clock: Clock;
  hasher: PasswordHasher;
  screener: PasswordScreener;
  lockout: LoginLockout;
  sessions: SessionService;
  verification: EmailVerificationService;
}

export function toCurrentUser(user: SessionUser): CurrentUser {
  return {
    id: user._id.toHexString(),
    email: user.email,
    name: user.name ?? null,
    role: user.role,
    emailVerified: user.emailVerifiedAt !== null,
  };
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  /** FR-A10: the length rule is in the shared schema; this adds the screening. */
  private async assertAcceptablePassword(password: string): Promise<void> {
    const result = await this.deps.screener.screen(password);
    if (!result.ok) {
      throw new AppError('PASSWORD_TOO_WEAK', [
        {
          path: 'password',
          message:
            result.reason === 'common'
              ? 'This password is too common. Choose another.'
              : 'This password has appeared in a data breach. Choose another.',
        },
      ]);
    }
  }

  /**
   * FR-A1, FR-A2. NFR-S15: the outcome is identical whether or not the email is registered.
   * The password is screened and hashed in both cases, and email goes out in the background,
   * so timing does not differ by much either.
   */
  async signup(body: SignupBody): Promise<void> {
    await this.assertAcceptablePassword(body.password);
    const passwordHash = await this.deps.hasher.hash(body.password);
    const now = this.deps.clock.now();
    const { verification } = this.deps;
    const { token, fields } = verification.newToken(now);
    try {
      await UserModel.create({
        email: body.email,
        passwordHash,
        name: body.name ?? null,
        privacyPolicyAcceptedAt: now, // NFR-PR4
        createdAt: now,
        ...fields,
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      // Existing address: same response (NFR-S15); see OQ-21 for what happens instead.
      await verification.reclaimUnverified(body.email, {
        passwordHash,
        name: body.name ?? null,
      });
      return;
    }
    verification.sendLink(body.email, token);
  }

  /**
   * Checks a password for `email` under the FR-A9 lockout. Returns the user on success.
   * Also used for password re-entry before account deletion (FR-D2).
   */
  async confirmPassword(email: string, password: string) {
    const { lockout, hasher } = this.deps;
    if (await lockout.isLocked(email)) throw new AppError('ACCOUNT_LOCKED');

    const user = await UserModel.findOne({ email })
      .select('+passwordHash')
      .lean<SessionUser & { passwordHash: string }>();
    const valid = user
      ? await hasher.verify(user.passwordHash, password)
      : await hasher.verifyAgainstDummy(password);

    if (!user || !valid) {
      const lockedNow = await lockout.recordFailure(email);
      if (lockedNow) {
        await AuditLogModel.create({
          actorId: 'system',
          targetUserId: user?._id ?? null,
          action: 'auth.login_failed_lockout',
          createdAt: this.deps.clock.now(),
        });
        throw new AppError('ACCOUNT_LOCKED');
      }
      throw new AppError('INVALID_CREDENTIALS');
    }
    await lockout.clear(email);
    const { passwordHash: _hash, ...safeUser } = user;
    return safeUser;
  }

  /** FR-A6, FR-A9, FR-A11. Unverified users may log in; they only reach verify screens (FR-A3). */
  async login(
    body: LoginBody,
    userAgent: string | undefined,
  ): Promise<IssuedSession & { user: SessionUser }> {
    const user = await this.confirmPassword(body.email, body.password);
    if (user.status !== 'active') throw new AppError('ACCOUNT_DISABLED');

    const now = this.deps.clock.now();
    await UserModel.updateOne({ _id: user._id }, { $set: { lastLoginAt: now, lastActiveAt: now } });
    const issued = await this.deps.sessions.create(user, userAgent);
    return { ...issued, user: { ...user, lastLoginAt: now, lastActiveAt: now } };
  }

  /**
   * AC-16: changing the password increments sessionVersion, which ends every session. The
   * caller gets a fresh session so only the other devices are signed out.
   */
  async changePassword(
    user: SessionUser,
    body: ChangePasswordBody,
    userAgent: string | undefined,
  ): Promise<IssuedSession & { user: SessionUser }> {
    await this.confirmPassword(user.email, body.currentPassword);
    await this.assertAcceptablePassword(body.newPassword);
    const passwordHash = await this.deps.hasher.hash(body.newPassword);

    const updated = await UserModel.findOneAndUpdate(
      { _id: user._id },
      { $set: { passwordHash }, $inc: { sessionVersion: 1 } },
      { returnDocument: 'after' },
    ).lean<SessionUser>();
    if (!updated) throw new AppError('UNAUTHENTICATED');

    await this.deps.sessions.revokeAll(user._id);
    await AuditLogModel.create({
      actorId: user._id.toHexString(),
      targetUserId: user._id,
      action: 'auth.password_changed',
      createdAt: this.deps.clock.now(),
    });
    const issued = await this.deps.sessions.create(updated, userAgent);
    return { ...issued, user: updated };
  }
}
