import { describe, expect, it } from 'vitest';
import { AuditLogModel, AuthSessionModel, UserModel } from '../../src/db/models/index.js';
import { useMigratedDb } from '../migrated-db.js';
import {
  OTHER_STRONG_PASSWORD,
  STRONG_PASSWORD,
  TestClient,
  createHarness,
  loggedInClient,
  uniqueEmail,
} from '../harness.js';

describe('AC-16: POST /auth/change-password', () => {
  useMigratedDb();
  const { app, breach } = createHarness();

  it('revokes other sessions and keeps the current device signed in', async () => {
    const email = uniqueEmail('change');
    const laptop = await loggedInClient(app, email);
    const phone = await new TestClient(app).init();
    await phone.login(email);
    const laptopOldCookie = laptop.cookieHeader();

    const res = await laptop.changePassword(STRONG_PASSWORD, OTHER_STRONG_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.csrfToken).toBe(laptop.csrfToken());

    // The device that changed the password got a new session and keeps working.
    expect((await laptop.me()).status).toBe(200);
    // Every other session, and the laptop's previous cookie, are revoked.
    expect((await phone.me()).status).toBe(401);
    const replay = await new TestClient(app).send('get', '/api/v1/auth/me', undefined, {
      headers: { Cookie: laptopOldCookie },
    });
    expect(replay.status).toBe(401);

    const user = await UserModel.findOne({ email }).lean();
    expect(user?.sessionVersion).toBe(1);
    const open = await AuthSessionModel.countDocuments({ userId: user?._id, revokedAt: null });
    expect(open).toBe(1);
  });

  it('switches which password works and writes an audit entry', async () => {
    const email = uniqueEmail('switch');
    const client = await loggedInClient(app, email);
    expect((await client.changePassword(STRONG_PASSWORD, OTHER_STRONG_PASSWORD)).status).toBe(200);

    const fresh = await new TestClient(app).init();
    expect((await fresh.login(email, STRONG_PASSWORD)).status).toBe(401);
    expect((await fresh.login(email, OTHER_STRONG_PASSWORD)).status).toBe(200);

    const user = await UserModel.findOne({ email }).lean();
    const audit = await AuditLogModel.findOne({ targetUserId: user?._id }).lean();
    expect(audit).toMatchObject({
      actorId: user?._id.toHexString(),
      action: 'auth.password_changed',
    });
  });

  it('rejects a wrong current password without changing anything', async () => {
    const email = uniqueEmail('wrong');
    const client = await loggedInClient(app, email);
    const res = await client.changePassword('not-my-password-1', OTHER_STRONG_PASSWORD);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect((await UserModel.findOne({ email }).lean())?.sessionVersion).toBe(0);
    expect((await client.me()).status).toBe(200);
  });

  it('applies FR-A10 screening to the new password', async () => {
    const email = uniqueEmail('screen');
    const client = await loggedInClient(app, email);
    breach.breached.add('breached-new-password');
    expect(
      (await client.changePassword(STRONG_PASSWORD, 'breached-new-password')).body.error.code,
    ).toBe('PASSWORD_TOO_WEAK');
    expect((await client.changePassword(STRONG_PASSWORD, 'qwertyuiop')).body.error.code).toBe(
      'PASSWORD_TOO_WEAK',
    );
    expect((await client.changePassword(STRONG_PASSWORD, STRONG_PASSWORD)).status).toBe(400);
  });

  it('wrong current passwords count toward the lockout (FR-A9)', async () => {
    const email = uniqueEmail('cp-lock');
    const client = await loggedInClient(app, email);
    for (let i = 0; i < 4; i += 1) {
      expect(
        (await client.changePassword('wrong-current-pass', OTHER_STRONG_PASSWORD)).status,
      ).toBe(401);
    }
    expect((await client.changePassword('wrong-current-pass', OTHER_STRONG_PASSWORD)).status).toBe(
      429,
    );
    expect((await client.changePassword(STRONG_PASSWORD, OTHER_STRONG_PASSWORD)).status).toBe(429);
  });
});
