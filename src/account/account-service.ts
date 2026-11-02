import type { AccountExport } from '../shared/index.js';
import mongoose from 'mongoose';
import {
  AuditLogModel,
  AuthSessionModel,
  LoginAttemptModel,
  ResourceModel,
  UserModel,
  VerificationThrottleModel,
} from '../db/models/index.js';
import type { AuthService } from '../auth/auth-service.js';
import type { SessionUser } from '../auth/session-service.js';
import { AppError } from '../lib/app-error.js';
import type { Clock } from '../lib/clock.js';
import { sha256Hex } from '../lib/crypto.js';
import type { ResourceService } from '../resources/resource-service.js';

const iso = (date: Date | null | undefined): string | null => (date ? date.toISOString() : null);

/** Account data rights (FR-D1 to FR-D3). */
export class AccountService {
  constructor(
    private readonly clock: Clock,
    private readonly auth: AuthService,
    private readonly resources: ResourceService,
  ) {}

  /**
   * FR-D1, AC-17: the account's own metadata and every resource. Fields are listed one by
   * one, so hashes, tokens, send times and sessionVersion can never slip in.
   */
  async export(user: SessionUser): Promise<AccountExport> {
    const now = this.clock.now();
    const fresh = await UserModel.findById(user._id).lean<SessionUser>();
    if (!fresh) throw new AppError('UNAUTHENTICATED');
    const result: AccountExport = {
      format: 'linkpocket-export',
      version: 1,
      exportedAt: now.toISOString(),
      account: {
        id: fresh._id.toHexString(),
        email: fresh.email,
        name: fresh.name ?? null,
        role: fresh.role,
        emailVerifiedAt: iso(fresh.emailVerifiedAt),
        privacyPolicyAcceptedAt: fresh.privacyPolicyAcceptedAt.toISOString(),
        createdAt: fresh.createdAt.toISOString(),
        lastLoginAt: iso(fresh.lastLoginAt),
        lastActiveAt: iso(fresh.lastActiveAt),
      },
      resources: await this.resources.all(fresh._id),
    };
    await AuditLogModel.create({
      actorId: fresh._id.toHexString(),
      targetUserId: fresh._id,
      action: 'user.export',
      createdAt: now,
    });
    return result;
  }

  /**
   * FR-D2, FR-D3, AC-18: after the password is re-entered (under the FR-A9 lockout), the user,
   * their resources and sessions are deleted in one transaction, and an audit entry holding
   * only the user id and the time is written in the same transaction. Deletion is immediate,
   * well inside the 30 days FR-D2 allows; backups age out under NFR-B3 (FR-D4).
   */
  async delete(user: SessionUser, password: string): Promise<void> {
    await this.auth.confirmPassword(user.email, password);
    const now = this.clock.now();

    await mongoose.connection.transaction(async (session) => {
      await ResourceModel.deleteMany({ userId: user._id }, { session });
      await AuthSessionModel.deleteMany({ userId: user._id }, { session });
      const { deletedCount } = await UserModel.deleteOne({ _id: user._id }, { session });
      if (deletedCount === 0) throw new AppError('UNAUTHENTICATED');
      await AuditLogModel.create(
        [
          {
            actorId: user._id.toHexString(),
            targetUserId: user._id,
            action: 'user.delete',
            createdAt: now,
          },
        ],
        { session },
      );
    });

    // Short-lived throttling state keyed by the email hash; it would expire on its own.
    const key = sha256Hex(user.email);
    await LoginAttemptModel.deleteOne({ _id: key });
    await VerificationThrottleModel.deleteOne({ _id: key });
  }
}
