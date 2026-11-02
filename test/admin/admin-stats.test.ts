import { adminStatsSchema, type AdminStats } from '../../src/shared/index.js';
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { ResourceModel, UserModel } from '../../src/db/models/index.js';
import { useMigratedDb } from '../migrated-db.js';
import { STRONG_PASSWORD, createHarness, loggedInClient } from '../harness.js';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(NOW.getTime() - ms);

/**
 * AC-11, FR-AD3, FR-AD4: the overview matches a hand-counted dataset. Windows are rolling
 * (now minus 7 or 30 days); "today" and the trend use UTC calendar days (OQ-40).
 */
describe('AC-11: admin overview counts match a seeded dataset', () => {
  useMigratedDb();
  const { app, clock } = createHarness();

  async function seed() {
    clock.set(NOW);
    // The admin is user 5: created now, verified, active now, no resources.
    const admin = await loggedInClient(app, 'stats-admin@example.com', STRONG_PASSWORD, 'admin');

    const user = (id: Types.ObjectId, createdAt: Date, extra: Record<string, unknown>) => ({
      _id: id,
      email: `${id.toHexString()}@example.com`,
      passwordHash: 'not-a-real-hash',
      privacyPolicyAcceptedAt: createdAt,
      createdAt,
      emailVerifiedAt: null,
      lastActiveAt: null,
      ...extra,
    });
    const [u1, u2, u3, u4] = [0, 1, 2, 3].map(() => new Types.ObjectId()) as [
      Types.ObjectId,
      Types.ObjectId,
      Types.ObjectId,
      Types.ObjectId,
    ];
    await UserModel.insertMany([
      user(u1, at(HOUR), { emailVerifiedAt: at(HOUR), lastActiveAt: at(HOUR) }),
      user(u2, at(5 * DAY), {}),
      user(u3, at(20 * DAY), { emailVerifiedAt: at(20 * DAY), lastActiveAt: at(10 * DAY) }),
      user(u4, at(60 * DAY), {
        emailVerifiedAt: at(60 * DAY),
        lastActiveAt: at(45 * DAY),
        status: 'disabled',
      }),
    ]);

    const resource = (userId: Types.ObjectId, createdAt: Date, pinned = false) => ({
      userId,
      url: 'https://example.com/',
      title: 'example.com',
      note: '',
      tags: [],
      isPinned: pinned,
      pinnedAt: pinned ? createdAt : null,
      createdAt,
      updatedAt: createdAt,
    });
    await ResourceModel.insertMany([
      resource(u1, at(30 * 60 * 1000), true), // r1 today, pinned
      resource(u1, at(20 * 60 * 1000)), // r2 today
      resource(u3, at(6 * DAY)), // r3
      resource(u3, at(15 * DAY), true), // r4 pinned
      resource(u3, at(19 * DAY)), // r5
      resource(u4, at(50 * DAY)), // r6, outside 30 days
    ]);
    return admin;
  }

  it('returns exactly the expected counts and a 30-day trend', async () => {
    const admin = await seed();
    const res = await admin.send('get', '/api/v1/admin/stats');
    expect(res.status).toBe(200);
    const stats = adminStatsSchema.parse(res.body);

    expect(stats.generatedAt).toBe(NOW.toISOString());
    expect(stats.users).toEqual({
      total: 5,
      verified: 4,
      unverified: 1,
      newToday: 2,
      new7d: 3,
      new30d: 4,
      active7d: 2,
      active30d: 3,
      withZeroResources: 2,
    } satisfies AdminStats['users']);
    expect(stats.resources).toEqual({
      total: 6,
      addedToday: 2,
      added7d: 3,
      added30d: 5,
      averagePerUser: 1.2,
      pinned: 2,
    } satisfies AdminStats['resources']);

    expect(stats.trend).toHaveLength(30);
    expect(stats.trend[0]?.date).toBe('2026-05-17');
    expect(stats.trend[29]?.date).toBe('2026-06-15');
    const nonZero = stats.trend.filter((day) => day.newUsers > 0 || day.resourcesAdded > 0);
    expect(nonZero).toEqual([
      { date: '2026-05-26', newUsers: 1, resourcesAdded: 0 },
      { date: '2026-05-27', newUsers: 0, resourcesAdded: 1 },
      { date: '2026-05-31', newUsers: 0, resourcesAdded: 1 },
      { date: '2026-06-09', newUsers: 0, resourcesAdded: 1 },
      { date: '2026-06-10', newUsers: 1, resourcesAdded: 0 },
      { date: '2026-06-15', newUsers: 2, resourcesAdded: 2 },
    ]);
  });

  it('FR-AD9: counts are computed on each request, so a refresh shows new data', async () => {
    const admin = await loggedInClient(app, 'stats-admin@example.com', STRONG_PASSWORD, 'admin');
    const before = adminStatsSchema.parse((await admin.send('get', '/api/v1/admin/stats')).body);
    await admin.send('post', '/api/v1/resources', { url: 'https://new.example.com/' });
    const after = adminStatsSchema.parse((await admin.send('get', '/api/v1/admin/stats')).body);
    expect(after.resources.total).toBe(before.resources.total + 1);
    expect(after.resources.addedToday).toBe(before.resources.addedToday + 1);
    expect(after.users.withZeroResources).toBe(before.users.withZeroResources - 1);
  });
});

describe('admin overview on an empty database', () => {
  useMigratedDb();
  const { app } = createHarness();

  it('reports zeros without dividing by zero (only the admin exists)', async () => {
    const admin = await loggedInClient(app, 'only-admin@example.com', STRONG_PASSWORD, 'admin');
    const stats = adminStatsSchema.parse((await admin.send('get', '/api/v1/admin/stats')).body);
    expect(stats.users.total).toBe(1);
    expect(stats.resources).toMatchObject({ total: 0, averagePerUser: 0, pinned: 0 });
    expect(stats.users.withZeroResources).toBe(1);
  });
});
