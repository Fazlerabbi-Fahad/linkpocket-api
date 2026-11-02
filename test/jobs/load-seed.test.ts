import { describe, expect, it } from 'vitest';
import { cleanLoadUsers, loadEmail, seedLoadUsers, SEARCH_WORDS } from '../../scripts/load-seed.js';
import { ResourceModel, UserModel } from '../../src/db/models/index.js';
import { useMigratedDb } from '../migrated-db.js';

describe('NFR-P5: load-test seed (staging only)', () => {
  useMigratedDb();

  it('creates verified accounts with full libraries, tops up on re-run, and cleans up', async () => {
    const options = {
      users: 3,
      resourcesPerUser: 20,
      passwordHash: 'x'.repeat(20),
      now: new Date(),
    };
    await UserModel.create({
      email: 'real.person@example.com',
      passwordHash: 'y'.repeat(20),
      privacyPolicyAcceptedAt: new Date(),
    });

    expect(await seedLoadUsers(options)).toEqual({ usersCreated: 3, resourcesCreated: 60 });
    expect(await seedLoadUsers(options)).toEqual({ usersCreated: 0, resourcesCreated: 0 });

    const user = await UserModel.findOne({ email: loadEmail(2) }).lean();
    expect(user?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(loadEmail(2)).toMatch(/@loadtest\.invalid$/);
    const titles = await ResourceModel.find({ userId: user?._id }).distinct('title');
    expect(titles.some((title) => title.includes(SEARCH_WORDS[0] ?? ''))).toBe(true);

    expect(await cleanLoadUsers()).toBe(3);
    expect(await UserModel.countDocuments()).toBe(1);
    expect(await ResourceModel.countDocuments()).toBe(0);
  });
});
