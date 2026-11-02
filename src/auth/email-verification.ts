import { TIMINGS, VERIFICATION_TOKEN_BYTES } from '../shared/index.js';
import type { Types } from 'mongoose';
import { UserModel, VerificationThrottleModel } from '../db/models/index.js';
import type { VerificationMailer } from '../email/verification-mailer.js';
import { AppError } from '../lib/app-error.js';
import type { Clock } from '../lib/clock.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import type { SessionService, SessionUser } from './session-service.js';

export interface EmailVerificationDeps {
  clock: Clock;
  mailer: VerificationMailer;
  sessions: SessionService;
}

export interface NewVerificationToken {
  token: string;
  fields: {
    emailVerificationTokenHash: string;
    emailVerificationExpiresAt: Date;
    verificationEmailSentAt: Date[];
  };
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

/**
 * Aggregation expression: true when one more send fits FR-A4 (no send in the last minute and
 * fewer than five in the last hour), given the field holding recent send times.
 */
function sendAllowed(field: string, now: Date) {
  const recent = {
    $filter: {
      input: { $ifNull: [field, []] },
      as: 'sent',
      cond: { $gt: ['$$sent', new Date(now.getTime() - TIMINGS.resendWindowMs)] },
    },
  };
  const minuteAgo = new Date(now.getTime() - TIMINGS.resendMinIntervalMs);
  return {
    $and: [
      { $lt: [{ $size: recent }, TIMINGS.resendMaxPerHour] },
      {
        $not: [
          { $anyElementTrue: [{ $map: { input: recent, in: { $gt: ['$$this', minuteAgo] } } }] },
        ],
      },
    ],
  };
}

/** Aggregation expression: the recent send times, pruned to the last hour, plus `now`. */
function appendSend(field: string, now: Date) {
  return {
    $concatArrays: [
      {
        $filter: {
          input: { $ifNull: [field, []] },
          as: 'sent',
          cond: { $gt: ['$$sent', new Date(now.getTime() - TIMINGS.resendWindowMs)] },
        },
      },
      [now],
    ],
  };
}

/**
 * Email verification (FR-A2, FR-A4, FR-A5, NFR-S9). Each account has at most one live token;
 * only its SHA-256 is stored, and issuing a new one replaces (invalidates) the old one.
 */
export class EmailVerificationService {
  constructor(private readonly deps: EmailVerificationDeps) {}

  private normalize(email: string): string {
    return email.trim().toLowerCase();
  }

  /** A token for a brand-new account. The signup counts as the first send (FR-A4). */
  newToken(now: Date): NewVerificationToken {
    const token = randomToken(VERIFICATION_TOKEN_BYTES);
    return {
      token,
      fields: {
        emailVerificationTokenHash: sha256Hex(token),
        emailVerificationExpiresAt: new Date(now.getTime() + TIMINGS.verificationLinkTtlMs),
        verificationEmailSentAt: [now],
      },
    };
  }

  sendLink(email: string, token: string): void {
    this.deps.mailer.send(email, token);
  }

  /**
   * If `email` is an active, unverified account and FR-A4 allows a send, atomically records
   * the send, replaces the token and applies `extra`, then queues the email. Returns the
   * account id, or null when there is no such account or the limit is reached.
   */
  private async reissue(
    email: string,
    extra: Record<string, unknown> = {},
  ): Promise<Types.ObjectId | null> {
    const now = this.deps.clock.now();
    const { token, fields } = this.newToken(now);
    const updated = await UserModel.collection.findOneAndUpdate(
      {
        email,
        emailVerifiedAt: null,
        status: 'active',
        $expr: sendAllowed('$verificationEmailSentAt', now),
      },
      [
        {
          $set: {
            ...extra,
            verificationEmailSentAt: appendSend('$verificationEmailSentAt', now),
            emailVerificationTokenHash: { $literal: fields.emailVerificationTokenHash },
            emailVerificationExpiresAt: fields.emailVerificationExpiresAt,
          },
        },
      ],
      { returnDocument: 'after', projection: { _id: 1 } },
    );
    if (!updated) return null;
    this.sendLink(email, token);
    return updated._id;
  }

  /**
   * FR-A4 for addresses with no unverified account (unknown, verified or disabled), so that
   * resend is limited, and answers, the same way for every address (NFR-S15, OQ-25).
   */
  private async consumeShadowSlot(email: string): Promise<boolean> {
    const now = this.deps.clock.now();
    const key = sha256Hex(email);
    const expiresAt = new Date(now.getTime() + TIMINGS.resendWindowMs);
    try {
      // First request for this address in the last hour.
      await VerificationThrottleModel.create({ _id: key, sentAt: [now], expiresAt });
      return true;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
    // MongoDB does not allow $expr in an upsert, so existing records are updated separately.
    const updated = await VerificationThrottleModel.collection.findOneAndUpdate(
      { _id: key, $expr: sendAllowed('$sentAt', now) } as Record<string, unknown>,
      [{ $set: { sentAt: appendSend('$sentAt', now), expiresAt } }],
    );
    return updated !== null;
  }

  /** POST /auth/resend-verification. */
  async resend(rawEmail: string): Promise<'accepted' | 'limited'> {
    const email = this.normalize(rawEmail);
    if (await this.reissue(email)) return 'accepted';
    const pending = await UserModel.exists({ email, emailVerifiedAt: null, status: 'active' });
    if (pending) return 'limited';
    return (await this.consumeShadowSlot(email)) ? 'accepted' : 'limited';
  }

  /**
   * Signup with an address that has an unverified account (OQ-21): the newest signup wins.
   * Its password replaces the old one, earlier sessions and links stop working, and a new
   * link is sent, all subject to FR-A4. This defeats account pre-registration by someone who
   * does not control the inbox. Verified or disabled accounts are left untouched.
   */
  async reclaimUnverified(
    rawEmail: string,
    replacement: { passwordHash: string; name: string | null },
  ): Promise<void> {
    const userId = await this.reissue(this.normalize(rawEmail), {
      // $literal: values starting with "$" (Argon2 hashes, user-chosen names) are not paths.
      passwordHash: { $literal: replacement.passwordHash },
      name: { $literal: replacement.name },
      privacyPolicyAcceptedAt: this.deps.clock.now(),
      sessionVersion: { $add: ['$sessionVersion', 1] },
    });
    if (userId) await this.deps.sessions.revokeAll(userId);
  }

  /**
   * FR-A5: a valid link verifies the account once. Used, expired, replaced and unknown tokens
   * all fail the same way. Every earlier session of the account is ended; the caller starts a
   * new one.
   */
  async verify(token: string): Promise<SessionUser> {
    const now = this.deps.clock.now();
    // Only the hash is looked up; the token itself is never stored or compared (NFR-S9).
    const user = await UserModel.findOneAndUpdate(
      {
        emailVerificationTokenHash: sha256Hex(token),
        emailVerificationExpiresAt: { $gt: now },
        emailVerifiedAt: null,
        status: 'active',
      },
      {
        $set: {
          emailVerifiedAt: now,
          emailVerificationTokenHash: null,
          emailVerificationExpiresAt: null,
          lastLoginAt: now,
          lastActiveAt: now,
        },
      },
      { returnDocument: 'after' },
    ).lean<SessionUser>();
    if (!user) throw new AppError('VERIFICATION_LINK_INVALID');
    await this.deps.sessions.revokeAll(user._id);
    return user;
  }
}
