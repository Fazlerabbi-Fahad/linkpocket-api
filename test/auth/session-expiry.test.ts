import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { AuthSessionModel, UserModel } from '../../src/db/models/index.js';
import { useMigratedDb } from '../migrated-db.js';
import { createHarness, loggedInClient, uniqueEmail } from '../harness.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('FR-A8: session expiry', () => {
  useMigratedDb();
  const { app, clock } = createHarness();

  it('expires after 7 days without activity', async () => {
    const client = await loggedInClient(app, uniqueEmail('idle'));
    clock.advance(7 * DAY - 1000);
    expect((await client.me()).status).toBe(200);
    // That request extended the window; a full idle week ends it.
    clock.advance(7 * DAY);
    const res = await client.me();
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('slides with use: regular activity keeps the session alive past 7 days', async () => {
    const client = await loggedInClient(app, uniqueEmail('active'));
    for (let day = 0; day < 10; day += 1) {
      clock.advance(DAY);
      expect((await client.me()).status).toBe(200);
    }
  });

  it('re-issues the cookie and records activity at most once an hour', async () => {
    const email = uniqueEmail('refresh');
    const client = await loggedInClient(app, email);
    const firstToken = client.cookies.get(SESSION_COOKIE);

    clock.advance(30 * 60 * 1000);
    const early = await client.me();
    expect(early.headers['set-cookie']).toBeUndefined();

    clock.advance(31 * 60 * 1000);
    await client.me();
    expect(client.cookies.get(SESSION_COOKIE)).not.toBe(firstToken);

    const user = await UserModel.findOne({ email }).lean();
    expect(user?.lastActiveAt).toEqual(clock.now());
    const session = await AuthSessionModel.findOne({ userId: user?._id }).lean();
    expect(session?.lastUsedAt).toEqual(clock.now());
  });

  it('ends admin sessions 24 hours after login regardless of activity (clarification 5)', async () => {
    const client = await loggedInClient(app, uniqueEmail('admin'), undefined, 'admin');
    for (let hour = 0; hour < 23; hour += 1) {
      clock.advance(HOUR);
      expect((await client.me()).status).toBe(200);
    }
    clock.advance(HOUR);
    expect((await client.me()).status).toBe(401);
  });

  it('applies the admin cap at once when a user is promoted mid-session', async () => {
    const email = uniqueEmail('promoted');
    const client = await loggedInClient(app, email);
    clock.advance(25 * HOUR);
    expect((await client.me()).status).toBe(200);
    await UserModel.updateOne({ email }, { $set: { role: 'admin' } });
    expect((await client.me()).status).toBe(401);
  });
});
