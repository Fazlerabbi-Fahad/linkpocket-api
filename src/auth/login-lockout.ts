import { TIMINGS } from '../shared/index.js';
import { LoginAttemptModel, type LoginAttempt } from '../db/models/index.js';
import type { Clock } from '../lib/clock.js';
import { sha256Hex } from '../lib/crypto.js';

/**
 * FR-A9: five failed logins for an email within 15 minutes lock that email for 15 minutes.
 * Counting is per email (not per IP), and works the same for emails with no account.
 */
export class LoginLockout {
  constructor(private readonly clock: Clock) {}

  private key(email: string): string {
    return sha256Hex(email.trim().toLowerCase());
  }

  async isLocked(email: string): Promise<boolean> {
    const record = await LoginAttemptModel.findById(this.key(email)).lean();
    const lockedUntil = record?.lockedUntil;
    return lockedUntil instanceof Date && lockedUntil > this.clock.now();
  }

  /** Records one failure atomically. Returns true when this failure triggered the lock. */
  async recordFailure(email: string): Promise<boolean> {
    const now = this.clock.now();
    const windowStart = new Date(now.getTime() - TIMINGS.loginLockoutWindowMs);
    const windowEnd = new Date(now.getTime() + TIMINGS.loginLockoutWindowMs);
    const lockUntil = new Date(now.getTime() + TIMINGS.loginLockoutDurationMs);

    // One pipeline update, so concurrent failures cannot under-count.
    const record = await LoginAttemptModel.collection.findOneAndUpdate(
      { _id: this.key(email) } as Record<string, unknown>,
      [
        {
          $set: {
            failures: {
              $concatArrays: [
                {
                  $filter: {
                    input: { $ifNull: ['$failures', []] },
                    as: 'failure',
                    cond: { $gt: ['$$failure', windowStart] },
                  },
                },
                [now],
              ],
            },
          },
        },
        {
          $set: {
            lockedUntil: {
              $cond: [
                { $gte: [{ $size: '$failures' }, TIMINGS.loginLockoutAttempts] },
                lockUntil,
                { $ifNull: ['$lockedUntil', null] },
              ],
            },
          },
        },
        {
          $set: {
            failures: { $cond: [{ $eq: ['$lockedUntil', lockUntil] }, [], '$failures'] },
            expiresAt: { $max: [{ $ifNull: ['$lockedUntil', now] }, windowEnd] },
          },
        },
      ],
      { upsert: true, returnDocument: 'after' },
    );
    const lockedUntil = (record as LoginAttempt | null)?.lockedUntil;
    return lockedUntil?.getTime() === lockUntil.getTime();
  }

  async clear(email: string): Promise<void> {
    await LoginAttemptModel.deleteOne({ _id: this.key(email) });
  }
}
