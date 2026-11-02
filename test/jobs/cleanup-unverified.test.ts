import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { AuthSessionModel, ResourceModel, UserModel } from '../../src/db/models/index.js';
import {
  cleanupUnverifiedAccounts,
  runCleanupUnverified,
} from '../../src/jobs/cleanup-unverified.js';
import { captureLogger } from '../capture-logger.js';
import { FakeClock, uniqueEmail } from '../harness.js';
import { useMigratedDb } from '../migrated-db.js';

const DAY = 24 * 60 * 60 * 1000;

async function makeUser(clock: FakeClock, ageMs: number, verified: boolean) {
  const createdAt = new Date(clock.now().getTime() - ageMs);
  const user = await UserModel.create({
    email: uniqueEmail('cleanup'),
    passwordHash: '$argon2id$placeholder',
    privacyPolicyAcceptedAt: createdAt,
    createdAt,
    emailVerifiedAt: verified ? createdAt : null,
  });
  await AuthSessionModel.create({
    userId: user._id,
    jti: new Types.ObjectId().toHexString(),
    createdAt,
    lastUsedAt: clock.now(),
    expiresAt: new Date(clock.now().getTime() + DAY),
  });
  return user._id;
}

describe('FR-A12: unverified account cleanup', () => {
  useMigratedDb();
  const clock = new FakeClock();

  it('deletes only accounts unverified for more than 7 days, with their sessions', async () => {
    const stale = await makeUser(clock, 7 * DAY + 1000, false);
    const recent = await makeUser(clock, 7 * DAY - 1000, false);
    const verifiedOld = await makeUser(clock, 30 * DAY, true);
    await ResourceModel.create({ userId: stale, url: 'https://example.com', title: 'x' });

    expect(await cleanupUnverifiedAccounts(clock)).toEqual({ deleted: 1 });

    expect(await UserModel.exists({ _id: stale })).toBeNull();
    expect(await AuthSessionModel.countDocuments({ userId: stale })).toBe(0);
    expect(await ResourceModel.countDocuments({ userId: stale })).toBe(0);
    for (const kept of [recent, verifiedOld]) {
      expect(await UserModel.exists({ _id: kept })).not.toBeNull();
      expect(await AuthSessionModel.countDocuments({ userId: kept })).toBe(1);
    }
  });

  it('is idempotent and safe to run concurrently (NFR-A5)', async () => {
    const ids = await Promise.all(Array.from({ length: 7 }, () => makeUser(clock, 8 * DAY, false)));
    const runs = await Promise.all([
      cleanupUnverifiedAccounts(clock, { batchSize: 3 }),
      cleanupUnverifiedAccounts(clock, { batchSize: 3 }),
    ]);
    expect(runs.reduce((sum, run) => sum + run.deleted, 0)).toBe(7);
    expect(await cleanupUnverifiedAccounts(clock)).toEqual({ deleted: 0 });
    expect(await UserModel.countDocuments({ _id: { $in: ids } })).toBe(0);
    expect(await AuthSessionModel.countDocuments({ userId: { $in: ids } })).toBe(0);
  });

  it('logs a count only (FR-A12)', async () => {
    const id = await makeUser(clock, 9 * DAY, false);
    const email = (await UserModel.findById(id).lean())?.email ?? '';
    const capture = captureLogger();

    expect(await runCleanupUnverified(clock, capture.logger)).toBe(1);
    expect(capture.lines).toHaveLength(1);
    const { level, time, service, msg, durationMs, ...rest } = capture.lines[0] ?? {};
    expect({ level, msg }).toEqual({ level: 30, msg: 'unverified account cleanup finished' });
    expect(service).toBe('linkpocket-api');
    expect([time, durationMs].every((value) => value !== undefined)).toBe(true);
    expect(rest).toEqual({ event: 'job_completed', job: 'cleanup-unverified', deleted: 1 });
    expect(capture.raw.join('')).not.toContain(email);
    expect(capture.raw.join('')).not.toContain(id.toHexString());
  });

  it('logs and rethrows failures', async () => {
    const capture = captureLogger();
    const broken = {
      now: () => {
        throw new TypeError('clock broke');
      },
    };
    await expect(runCleanupUnverified(broken, capture.logger)).rejects.toThrow('clock broke');
    expect(capture.lines[0]).toMatchObject({
      level: 50,
      event: 'job_failed',
      job: 'cleanup-unverified',
      reason: 'TypeError',
    });
  });
});
