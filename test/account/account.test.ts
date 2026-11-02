import { accountExportSchema, type AccountExport } from '../../src/shared/index.js';
import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import {
  AuditLogModel,
  AuthSessionModel,
  ResourceModel,
  UserModel,
} from '../../src/db/models/index.js';
import { useMigratedDb } from '../migrated-db.js';
import {
  STRONG_PASSWORD,
  TestClient,
  createHarness,
  loggedInClient,
  uniqueEmail,
} from '../harness.js';

const EXPORT = '/api/v1/account/export';
const ACCOUNT = '/api/v1/account';

async function withResources(client: TestClient, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await client.send('post', '/api/v1/resources', {
      url: `example.com/${i}`,
      title: `Saved ${i}`,
      note: `note ${i}`,
      tags: ['export'],
    });
  }
}

describe('AC-17 / FR-D1: export', () => {
  useMigratedDb();
  const { app, clock } = createHarness();

  it('downloads the account metadata and every resource as JSON', async () => {
    const email = uniqueEmail('export');
    const client = await loggedInClient(app, email);
    await withResources(client, 3);

    const res = await client.send('get', EXPORT);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename=linkpocket-export-${clock.now().toISOString().slice(0, 10)}.json`,
    );
    expect(res.headers['cache-control']).toBe('no-store');

    // Strict schema: any extra field, such as a secret, fails the parse.
    const data: AccountExport = accountExportSchema.parse(res.body);
    expect(data.account).toMatchObject({ email, role: 'user' });
    expect(data.resources.map((resource) => resource.title).sort()).toEqual([
      'Saved 0',
      'Saved 1',
      'Saved 2',
    ]);
    expect(data.exportedAt).toBe(clock.now().toISOString());
  });

  it('contains no password hash, tokens or session data', async () => {
    const email = uniqueEmail('secrets');
    const client = await loggedInClient(app, email);
    const stored = await UserModel.findOne({ email })
      .select('+passwordHash +emailVerificationTokenHash')
      .lean();
    const session = await AuthSessionModel.findOne({ userId: stored?._id }).lean();
    // The signup token hash is still stored (the test user was verified directly).
    expect(stored?.emailVerificationTokenHash).toMatch(/^[a-f0-9]{64}$/);

    const text = JSON.stringify((await client.send('get', EXPORT)).body);
    for (const secret of [
      stored?.passwordHash,
      stored?.emailVerificationTokenHash,
      session?.jti,
      client.cookies.get(SESSION_COOKIE),
      client.csrfToken(),
    ]) {
      expect(secret).toBeTruthy();
      expect(text).not.toContain(secret);
    }
    for (const field of [
      'passwordHash',
      'emailVerificationTokenHash',
      'emailVerificationExpiresAt',
      'verificationEmailSentAt',
      'sessionVersion',
      'userId',
      'argon2',
    ]) {
      expect(text).not.toContain(field);
    }
  });

  it('writes a user.export audit entry', async () => {
    const email = uniqueEmail('export-audit');
    const client = await loggedInClient(app, email);
    await client.send('get', EXPORT);
    const user = await UserModel.findOne({ email }).lean();
    const entries = await AuditLogModel.find({
      targetUserId: user?._id,
      action: 'user.export',
    }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.actorId).toBe(user?._id.toHexString());
  });
});

describe('AC-18 / FR-D2, FR-D3: account deletion', () => {
  useMigratedDb();
  const { app, clock } = createHarness();

  it('removes the user, every resource and session, and writes an audit entry', async () => {
    const email = uniqueEmail('delete');
    const client = await loggedInClient(app, email);
    const phone = await new TestClient(app).init();
    await phone.login(email);
    await withResources(client, 4);
    const user = await UserModel.findOne({ email }).lean();
    const id = user?._id;
    const stolenCookie = client.cookieHeader();

    const res = await client.send('delete', ACCOUNT, { password: STRONG_PASSWORD });
    expect(res.status).toBe(204);
    expect(client.cookies.has(SESSION_COOKIE)).toBe(false);

    expect(await UserModel.exists({ _id: id })).toBeNull();
    expect(await ResourceModel.countDocuments({ userId: id })).toBe(0);
    expect(await AuthSessionModel.countDocuments({ userId: id })).toBe(0);

    // FR-D3: user id and timestamp only, no other personal data.
    const entries = await AuditLogModel.find({ action: 'user.delete', targetUserId: id }).lean();
    expect(entries).toHaveLength(1);
    const { _id, ...entry } = entries[0] ?? {};
    expect(entry).toEqual({
      actorId: id?.toHexString(),
      targetUserId: id,
      action: 'user.delete',
      createdAt: clock.now(),
    });
    expect(JSON.stringify(entries)).not.toContain(email);

    // Every session is gone, on this device and others.
    const replay = await new TestClient(app).send('get', '/api/v1/auth/me', undefined, {
      headers: { Cookie: stolenCookie },
    });
    expect(replay.status).toBe(401);
    expect((await phone.me()).status).toBe(401);
    expect((await (await new TestClient(app).init()).login(email)).status).toBe(401);
  });

  it('frees the address for a new signup', async () => {
    const email = uniqueEmail('again');
    const client = await loggedInClient(app, email);
    await client.send('delete', ACCOUNT, { password: STRONG_PASSWORD });
    expect((await (await new TestClient(app).init()).signup(email)).status).toBe(202);
    expect(await UserModel.countDocuments({ email })).toBe(1);
  });

  it('requires the correct password and deletes nothing otherwise', async () => {
    const email = uniqueEmail('wrong');
    const client = await loggedInClient(app, email);
    await withResources(client, 1);

    const wrong = await client.send('delete', ACCOUNT, { password: 'not-my-password-1' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    const missing = await client.send('delete', ACCOUNT, {});
    expect(missing.status).toBe(400);

    expect(await UserModel.exists({ email })).not.toBeNull();
    expect((await client.me()).status).toBe(200);
    const user = await UserModel.findOne({ email }).lean();
    expect(
      await AuditLogModel.countDocuments({ action: 'user.delete', targetUserId: user?._id }),
    ).toBe(0);
  });

  it('counts wrong passwords toward the login lockout (FR-A9)', async () => {
    const email = uniqueEmail('lock');
    const client = await loggedInClient(app, email);
    const codes: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await client.send('delete', ACCOUNT, { password: `wrong-password-${i}` });
      codes.push(res.body.error.code);
    }
    expect(codes.at(-1)).toBe('ACCOUNT_LOCKED');
    const locked = await client.send('delete', ACCOUNT, { password: STRONG_PASSWORD });
    expect(locked.status).toBe(429);
    expect(await UserModel.exists({ email })).not.toBeNull();
  });

  it('requires the CSRF header (NFR-S10)', async () => {
    const email = uniqueEmail('csrf');
    const client = await loggedInClient(app, email);
    const res = await client.send(
      'delete',
      ACCOUNT,
      { password: STRONG_PASSWORD },
      { csrf: false },
    );
    expect(res.status).toBe(403);
    expect(await UserModel.exists({ email })).not.toBeNull();
  });
});
