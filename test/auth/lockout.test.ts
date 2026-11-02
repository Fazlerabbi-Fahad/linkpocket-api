import { TIMINGS } from '../../src/shared/index.js';
import { describe, expect, it } from 'vitest';
import { AuditLogModel, LoginAttemptModel, UserModel } from '../../src/db/models/index.js';
import { sha256Hex } from '../../src/lib/crypto.js';
import { useMigratedDb } from '../migrated-db.js';
import {
  STRONG_PASSWORD,
  TestClient,
  createHarness,
  createVerifiedUser,
  uniqueEmail,
} from '../harness.js';

const WRONG = 'definitely-wrong-password';
const MINUTE = 60_000;

describe('AC-15 / FR-A9: login lockout', () => {
  useMigratedDb();
  const { app, clock } = createHarness();

  async function fail(client: TestClient, email: string, times: number) {
    const statuses: number[] = [];
    for (let i = 0; i < times; i += 1) statuses.push((await client.login(email, WRONG)).status);
    return statuses;
  }

  it('locks after 5 failures, even for the right password, and clears after 15 minutes', async () => {
    const email = uniqueEmail('lock');
    const client = await createVerifiedUser(app, email);

    expect(await fail(client, email, 4)).toEqual([401, 401, 401, 401]);
    const fifth = await client.login(email, WRONG);
    expect(fifth.status).toBe(429);
    expect(fifth.body.error.code).toBe('ACCOUNT_LOCKED');

    const locked = await client.login(email, STRONG_PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');

    clock.advance(TIMINGS.loginLockoutDurationMs - 1000);
    expect((await client.login(email, STRONG_PASSWORD)).status).toBe(429);

    clock.advance(1000);
    expect((await client.login(email, STRONG_PASSWORD)).status).toBe(200);
  });

  it('writes one audit entry with IDs only when the lock starts', async () => {
    const email = uniqueEmail('audit');
    const client = await createVerifiedUser(app, email);
    const user = await UserModel.findOne({ email }).lean();

    await fail(client, email, 7);
    const entries = await AuditLogModel.find({ targetUserId: user?._id }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorId: 'system', action: 'auth.login_failed_lockout' });
  });

  it('only counts failures inside the 15-minute window', async () => {
    const email = uniqueEmail('window');
    const client = await createVerifiedUser(app, email);

    await fail(client, email, 4);
    clock.advance(16 * MINUTE);
    expect(await fail(client, email, 4)).toEqual([401, 401, 401, 401]);
    expect((await client.login(email, STRONG_PASSWORD)).status).toBe(200);
  });

  it('a successful login resets the count', async () => {
    const email = uniqueEmail('reset');
    const client = await createVerifiedUser(app, email);
    await fail(client, email, 4);
    expect((await client.login(email, STRONG_PASSWORD)).status).toBe(200);
    expect(await fail(client, email, 4)).toEqual([401, 401, 401, 401]);
  });

  it('locks unknown emails the same way, storing only a hash of the address', async () => {
    const email = uniqueEmail('ghost');
    const client = await new TestClient(app).init();
    expect(await fail(client, email, 5)).toEqual([401, 401, 401, 401, 429]);

    const record = await LoginAttemptModel.findById(sha256Hex(email)).lean();
    expect(record?.lockedUntil).toEqual(new Date(clock.now().getTime() + 15 * MINUTE));
    expect(JSON.stringify(await LoginAttemptModel.find().lean())).not.toContain(email);
  });

  it('is keyed per email: another account is unaffected', async () => {
    const locked = uniqueEmail('locked');
    const other = uniqueEmail('other');
    const client = await createVerifiedUser(app, locked);
    await createVerifiedUser(app, other);
    await fail(client, locked, 5);
    expect((await client.login(other, STRONG_PASSWORD)).status).toBe(200);
  });
});
