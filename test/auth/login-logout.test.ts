import { describe, expect, it } from 'vitest';
import { CSRF_COOKIE, SESSION_COOKIE } from '../../src/auth/cookies.js';
import { AuthSessionModel, UserModel } from '../../src/db/models/index.js';
import { useMigratedDb } from '../migrated-db.js';
import {
  STRONG_PASSWORD,
  TestClient,
  createHarness,
  createVerifiedUser,
  loggedInClient,
  uniqueEmail,
} from '../harness.js';

/**
 * Endpoints that require a verified user (AC-2). Phases 5 and 6 append the resource and
 * account endpoints here, so every one of them is checked for unverified access.
 */
const VERIFIED_ONLY_ENDPOINTS: ['post' | 'get' | 'patch' | 'delete', string, unknown][] = [
  [
    'post',
    '/api/v1/auth/change-password',
    { currentPassword: STRONG_PASSWORD, newPassword: 'n3w-pass-phrase-ok' },
  ],
  ['get', '/api/v1/resources', undefined],
  ['post', '/api/v1/resources', { url: 'example.com' }],
  ['get', '/api/v1/resources/0123456789abcdef01234567', undefined],
  ['patch', '/api/v1/resources/0123456789abcdef01234567', { isPinned: true }],
  ['delete', '/api/v1/resources/0123456789abcdef01234567', undefined],
  ['get', '/api/v1/account/export', undefined],
  ['delete', '/api/v1/account', { password: STRONG_PASSWORD }],
];

describe('login, me, logout', () => {
  useMigratedDb();
  const { app, clock } = createHarness();

  it('sets an httpOnly, Secure, SameSite=Lax host-only session cookie (NFR-S2, ADR-0002)', async () => {
    const email = uniqueEmail('cookie');
    const client = await createVerifiedUser(app, email);
    const res = await client.login(email);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Object.keys(res.body.user).sort()).toEqual([
      'email',
      'emailVerified',
      'id',
      'name',
      'role',
    ]);
    expect(res.body.user).toMatchObject({ email, name: null, role: 'user', emailVerified: true });
    expect(res.body.user.id).toMatch(/^[a-f0-9]{24}$/);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const session = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(session).toMatch(/; HttpOnly/);
    expect(session).toMatch(/; Secure/);
    expect(session).toMatch(/; SameSite=Lax/);
    expect(session).toMatch(/; Path=\//);
    expect(session).not.toMatch(/Domain=/i);
    expect(session).toMatch(/Max-Age=604800/); // 7 days (FR-A8)

    const csrf = cookies.find((c) => c.startsWith(`${CSRF_COOKIE}=`));
    expect(csrf).not.toMatch(/HttpOnly/);
    expect(res.body.csrfToken).toBe(client.csrfToken());

    const user = await UserModel.findOne({ email }).lean();
    expect(user?.lastLoginAt).toEqual(clock.now());
  });

  it('never exposes the password hash (SRS 5.1)', async () => {
    const email = uniqueEmail('nohash');
    const client = await loggedInClient(app, email);
    const me = await client.me();
    expect(me.status).toBe(200);
    expect(JSON.stringify(me.body)).not.toMatch(/argon2|passwordHash/);
  });

  it('gives the same generic error for a wrong password and an unknown email', async () => {
    const email = uniqueEmail('generic');
    const client = await createVerifiedUser(app, email);
    const wrong = await client.login(email, 'not-the-password-123');
    const unknown = await client.login(uniqueEmail('nobody'), 'not-the-password-123');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('requires a session for /auth/me', async () => {
    const res = await new TestClient(app).me();
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('logout revokes the server-side session, not only the cookie (FR-A6)', async () => {
    const email = uniqueEmail('logout');
    const client = await loggedInClient(app, email);
    const stolenCookie = client.cookieHeader();

    const res = await client.logout();
    expect(res.status).toBe(204);
    expect(client.cookies.has(SESSION_COOKIE)).toBe(false);

    const user = await UserModel.findOne({ email }).lean();
    const record = await AuthSessionModel.findOne({ userId: user?._id }).lean();
    expect(record?.revokedAt).toEqual(clock.now());

    // Replaying the old cookie, which is still a validly signed JWT, no longer works.
    const replay = await new TestClient(app).send('get', '/api/v1/auth/me', undefined, {
      headers: { Cookie: stolenCookie },
    });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('logging out one session leaves the others signed in', async () => {
    const email = uniqueEmail('multi');
    const laptop = await loggedInClient(app, email);
    const phone = await new TestClient(app).init();
    expect((await phone.login(email)).status).toBe(200);

    await laptop.logout();
    expect((await laptop.me()).status).toBe(401);
    expect((await phone.me()).status).toBe(200);
  });

  it('logout without a session still succeeds and clears cookies', async () => {
    const client = await new TestClient(app).init();
    expect((await client.logout()).status).toBe(204);
  });
});

describe('AC-2 / FR-A3: unverified users', () => {
  useMigratedDb();
  const { app } = createHarness();

  it('can log in and see that they are unverified', async () => {
    const email = uniqueEmail('unverified');
    const client = await new TestClient(app).init();
    await client.signup(email);
    const login = await client.login(email);
    expect(login.status).toBe(200);
    expect(login.body.user.emailVerified).toBe(false);
    expect((await client.me()).body.user.emailVerified).toBe(false);
  });

  it.each(VERIFIED_ONLY_ENDPOINTS)('are refused %s %s with 403', async (method, path, body) => {
    const email = uniqueEmail('unverified');
    const client = await new TestClient(app).init();
    await client.signup(email);
    await client.login(email);

    const res = await client.send(method, path, body);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it.each(VERIFIED_ONLY_ENDPOINTS)('anonymous %s %s gets 401', async (method, path, body) => {
    const res = await (await new TestClient(app).init()).send(method, path, body);
    expect(res.status).toBe(401);
  });
});
