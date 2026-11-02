import { TIMINGS } from '../shared/index.js';
import { AuthSessionModel, ResourceModel, UserModel } from '../db/models/index.js';
import type { Clock } from '../lib/clock.js';
import type { Logger } from '../lib/logger.js';

export const CLEANUP_UNVERIFIED_JOB = 'cleanup-unverified';

/**
 * FR-A12: deletes accounts still unverified 7 days after signup, with their sessions (and any
 * resources, although AC-2 means there should be none). Idempotent and safe to run twice at
 * once (NFR-A5): every delete re-checks the same filter, so an account verified mid-run is
 * kept, and a second run finds nothing left to do. Uses the users
 * `{ emailVerifiedAt: 1, createdAt: 1 }` index from SRS 5.1.
 */
export async function cleanupUnverifiedAccounts(
  clock: Clock,
  options: { batchSize?: number } = {},
): Promise<{ deleted: number }> {
  const batchSize = options.batchSize ?? 500;
  const filter = {
    emailVerifiedAt: null,
    createdAt: { $lt: new Date(clock.now().getTime() - TIMINGS.unverifiedAccountMaxAgeMs) },
  };
  let deleted = 0;

  for (;;) {
    const batch = await UserModel.find(filter, { _id: 1 })
      .sort({ emailVerifiedAt: 1, createdAt: 1 })
      .limit(batchSize)
      .lean();
    if (batch.length === 0) break;
    const ids = batch.map((user) => user._id);

    const result = await UserModel.deleteMany({ ...filter, _id: { $in: ids } });
    deleted += result.deletedCount;

    // Only remove dependants of accounts that are really gone.
    const kept = new Set(
      (await UserModel.find({ _id: { $in: ids } }, { _id: 1 }).lean()).map((user) =>
        user._id.toHexString(),
      ),
    );
    const gone = ids.filter((id) => !kept.has(id.toHexString()));
    if (gone.length > 0) {
      await AuthSessionModel.deleteMany({ userId: { $in: gone } });
      await ResourceModel.deleteMany({ userId: { $in: gone } });
    }
    if (batch.length < batchSize) break;
  }
  return { deleted };
}

/** Runs the job and writes its one log line: a count only, no addresses (FR-A12, NFR-O3). */
export async function runCleanupUnverified(clock: Clock, logger: Logger): Promise<number> {
  const startedAt = Date.now();
  try {
    const { deleted } = await cleanupUnverifiedAccounts(clock);
    logger.info(
      {
        event: 'job_completed',
        job: CLEANUP_UNVERIFIED_JOB,
        deleted,
        durationMs: Date.now() - startedAt,
      },
      'unverified account cleanup finished',
    );
    return deleted;
  } catch (error) {
    logger.error(
      {
        event: 'job_failed',
        job: CLEANUP_UNVERIFIED_JOB,
        reason: error instanceof Error ? error.name : 'unknown',
      },
      'unverified account cleanup failed',
    );
    throw error;
  }
}
