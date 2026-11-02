import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { UserModel } from '../../src/db/models/index.js';
import { useMigratedDb } from '../migrated-db.js';
import {
  STRONG_PASSWORD,
  TestClient,
  createHarness,
  loggedInClient,
  uniqueEmail,
} from '../harness.js';

/**
 * AC-13 / FR-A11. The admin disable endpoint (test/admin/admin-users.test.ts) sets status and
 * increments sessionVersion. Both effects are tested separately here so either one alone is
 * enough to stop existing sessions.
 */
describe('AC-13: disabled users', () => {
  useMigratedDb();
  const { app } = createHarness();

  it('cannot log in', async () => {
    const email = uniqueEmail('disabled');
    await loggedInClient(app, email);
    await UserModel.updateOne({ email }, { $set: { status: 'disabled' } });

    const res = await (await new TestClient(app).init()).login(email, STRONG_PASSWORD);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
    expect(res.headers['set-cookie']?.toString() ?? '').not.toContain(`${SESSION_COOKIE}=ey`);
  });

  it('existing sessions stop working on the next request (status change alone)', async () => {
    const email = uniqueEmail('disabled-session');
    const client = await loggedInClient(app, email);
    expect((await client.me()).status).toBe(200);

    await UserModel.updateOne({ email }, { $set: { status: 'disabled' } });
    const res = await client.me();
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
    expect(client.cookies.has(SESSION_COOKIE)).toBe(false);
  });

  it('a sessionVersion bump alone also ends existing sessions (NFR-S3)', async () => {
    const email = uniqueEmail('version');
    const client = await loggedInClient(app, email);
    await UserModel.updateOne({ email }, { $inc: { sessionVersion: 1 } });
    const res = await client.me();
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('re-enabling allows a fresh login', async () => {
    const email = uniqueEmail('reenabled');
    await loggedInClient(app, email);
    await UserModel.updateOne(
      { email },
      { $set: { status: 'disabled' }, $inc: { sessionVersion: 1 } },
    );
    await UserModel.updateOne({ email }, { $set: { status: 'active' } });
    const client = await new TestClient(app).init();
    expect((await client.login(email)).status).toBe(200);
    expect((await client.me()).status).toBe(200);
  });
});
