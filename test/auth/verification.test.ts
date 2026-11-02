import { describe, expect, it } from 'vitest';
import { RESEND_RESPONSE } from '../../src/auth/auth-routes.js';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { UserModel } from '../../src/db/models/index.js';
import { randomToken, sha256Hex } from '../../src/lib/crypto.js';
import { useMigratedDb } from '../migrated-db.js';
import {
  OTHER_STRONG_PASSWORD,
  STRONG_PASSWORD,
  TestClient,
  comparable,
  createHarness,
  createVerifiedUser,
  testConfig,
  uniqueEmail,
} from '../harness.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

describe('FR-A2 / NFR-S9: signup sends a verification email', () => {
  useMigratedDb();
  const { app, clock, config, mail, emailsSettled } = createHarness();

  it('sends one link and stores only the SHA-256 of its token', async () => {
    const email = uniqueEmail('link');
    await (await new TestClient(app).init()).signup(email);
    await emailsSettled();

    const messages = mail.to(email);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.subject).toBe('Verify your email for LinkPocket');
    const token = mail.latestToken(email);
    const link = `${config.webOrigin}/verify-email#token=${token}`;
    expect(messages[0]?.text).toContain(link);
    expect(messages[0]?.html).toContain(`href="${link}"`);
    // The token is in the fragment, never in a query string sent to servers.
    expect(link).not.toContain('?');
    expect(messages[0]?.idempotencyKey).toBe(`verify-email/${sha256Hex(token)}`);

    const user = await UserModel.findOne({ email }).select('+emailVerificationTokenHash').lean();
    expect(user?.emailVerificationTokenHash).toBe(sha256Hex(token));
    expect(JSON.stringify(user)).not.toContain(token);
    expect(user?.emailVerificationExpiresAt).toEqual(new Date(clock.now().getTime() + 24 * HOUR));
    expect(user?.verificationEmailSentAt).toEqual([clock.now()]);
  });

  it('uses 32 random bytes per token', async () => {
    const email = uniqueEmail('entropy');
    await (await new TestClient(app).init()).signup(email);
    await emailsSettled();
    expect(Buffer.from(mail.latestToken(email), 'base64url')).toHaveLength(32);
  });
});

describe('AC-3 / FR-A5: a verification link works once', () => {
  useMigratedDb();
  const { app, clock, mail, emailsSettled } = createHarness();

  async function signedUp(label: string) {
    const email = uniqueEmail(label);
    const client = await new TestClient(app).init();
    await client.signup(email);
    await emailsSettled();
    return { email, client, token: mail.latestToken(email) };
  }

  it('verifies the account and starts a session', async () => {
    const { email, token } = await signedUp('verify');
    const browser = await new TestClient(app).init();
    const res = await browser.verifyEmail(token);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.user).toMatchObject({ email, emailVerified: true });
    expect(browser.cookies.has(SESSION_COOKIE)).toBe(true);
    expect(res.body.csrfToken).toBe(browser.csrfToken());
    expect((await browser.me()).body.user.emailVerified).toBe(true);

    // Verified-only endpoints now let the user through (the inverse of AC-2).
    const change = await browser.changePassword(STRONG_PASSWORD, OTHER_STRONG_PASSWORD);
    expect(change.status).toBe(200);

    const user = await UserModel.findOne({ email }).select('+emailVerificationTokenHash').lean();
    expect(user?.emailVerifiedAt).toEqual(clock.now());
    expect(user?.emailVerificationTokenHash).toBeNull();
    expect(user?.emailVerificationExpiresAt).toBeNull();
  });

  it('fails on reuse with an error the web app turns into a resend option', async () => {
    const { token } = await signedUp('reuse');
    expect((await (await new TestClient(app).init()).verifyEmail(token)).status).toBe(200);

    const again = await (await new TestClient(app).init()).verifyEmail(token);
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('VERIFICATION_LINK_INVALID');
    expect(again.headers['set-cookie']?.toString() ?? '').not.toContain(`${SESSION_COOKIE}=ey`);
  });

  it('fails after 24 hours; a resent link then works', async () => {
    const { email, token } = await signedUp('expired');
    clock.advance(24 * HOUR + SECOND);
    const browser = await new TestClient(app).init();

    const expired = await browser.verifyEmail(token);
    expect(expired.status).toBe(400);
    expect(expired.body.error.code).toBe('VERIFICATION_LINK_INVALID');

    expect((await browser.resendVerification(email)).status).toBe(202);
    await emailsSettled();
    const fresh = mail.latestToken(email);
    expect(fresh).not.toBe(token);
    expect((await browser.verifyEmail(fresh)).status).toBe(200);
  });

  it('still works just before 24 hours', async () => {
    const { token } = await signedUp('in-time');
    clock.advance(24 * HOUR - SECOND);
    expect((await (await new TestClient(app).init()).verifyEmail(token)).status).toBe(200);
  });

  it('is replaced by a resend: only the newest link works', async () => {
    const { email, token } = await signedUp('replaced');
    clock.advance(MINUTE + SECOND);
    const browser = await new TestClient(app).init();
    await browser.resendVerification(email);
    await emailsSettled();

    expect((await browser.verifyEmail(token)).body.error.code).toBe('VERIFICATION_LINK_INVALID');
    expect((await browser.verifyEmail(mail.latestToken(email))).status).toBe(200);
  });

  it.each([
    ['unknown', randomToken(32)],
    ['too short', 'abc'],
    ['not a string', 12345],
    ['missing', undefined],
  ])('rejects a %s token the same way', async (_label, token) => {
    const res = await (await new TestClient(app).init()).verifyEmail(token);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VERIFICATION_LINK_INVALID');
    expect(res.body.error.fields).toBeUndefined();
  });

  it('ends sessions that existed before verification', async () => {
    const { email, client, token } = await signedUp('pre-session');
    await client.login(email);
    expect((await client.me()).status).toBe(200);

    const other = await new TestClient(app).init();
    expect((await other.verifyEmail(token)).status).toBe(200);
    expect((await client.me()).status).toBe(401);
    expect((await other.me()).status).toBe(200);
  });

  it('does not verify a disabled account', async () => {
    const { email, token } = await signedUp('disabled');
    await UserModel.updateOne({ email }, { $set: { status: 'disabled' } });
    const res = await (await new TestClient(app).init()).verifyEmail(token);
    expect(res.body.error.code).toBe('VERIFICATION_LINK_INVALID');
    expect((await UserModel.findOne({ email }).lean())?.emailVerifiedAt).toBeNull();
  });

  it('requires a CSRF token (NFR-S10)', async () => {
    const { token } = await signedUp('csrf');
    const client = await new TestClient(app).init();
    const res = await client.send('post', '/api/v1/auth/verify-email', { token }, { csrf: false });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });
});

describe('AC-4 / FR-A4: resend limits', () => {
  useMigratedDb();
  const { app, clock, mail, emailsSettled } = createHarness();

  async function sendsTo(email: string): Promise<number> {
    await emailsSettled();
    return mail.to(email).length;
  }

  it('allows one send per 60 seconds, counting the signup email', async () => {
    const email = uniqueEmail('minute');
    const client = await new TestClient(app).init();
    await client.signup(email);

    const blocked = await client.resendVerification(email);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(await sendsTo(email)).toBe(1);

    clock.advance(MINUTE - SECOND);
    expect((await client.resendVerification(email)).status).toBe(429);
    clock.advance(2 * SECOND);
    const allowed = await client.resendVerification(email);
    expect(allowed.status).toBe(202);
    expect(allowed.body).toEqual(RESEND_RESPONSE);
    expect(await sendsTo(email)).toBe(2);
    expect((await client.resendVerification(email)).status).toBe(429);
  });

  it('allows at most 5 sends per hour', async () => {
    const email = uniqueEmail('hour');
    const client = await new TestClient(app).init();
    const start = clock.now().getTime();
    await client.signup(email);
    for (let i = 0; i < 4; i += 1) {
      clock.advance(MINUTE + SECOND);
      expect((await client.resendVerification(email)).status).toBe(202);
    }
    expect(await sendsTo(email)).toBe(5);

    clock.advance(10 * MINUTE);
    expect((await client.resendVerification(email)).status).toBe(429);
    expect(await sendsTo(email)).toBe(5);

    // Once the signup email is more than an hour old, one slot opens again.
    clock.advance(start + HOUR + SECOND - clock.now().getTime());
    expect((await client.resendVerification(email)).status).toBe(202);
    expect((await client.resendVerification(email)).status).toBe(429);
    expect(await sendsTo(email)).toBe(6);

    const user = await UserModel.findOne({ email }).lean();
    expect(user?.verificationEmailSentAt).toHaveLength(5); // pruned to the last hour
  });

  it('counts per address, ignoring case and spaces', async () => {
    const email = uniqueEmail('case');
    const client = await new TestClient(app).init();
    await client.signup(email);
    expect((await client.resendVerification(` ${email.toUpperCase()} `)).status).toBe(429);
  });

  it('is enforced per IP as well (NFR-S14)', async () => {
    const limited = createHarness({
      rateLimits: {
        ...testConfig().rateLimits,
        resendVerification: { windowMs: HOUR, limit: 2 },
      },
    });
    const client = await new TestClient(limited.app).init();
    expect((await client.resendVerification(uniqueEmail('ip1'))).status).toBe(202);
    expect((await client.resendVerification(uniqueEmail('ip2'))).status).toBe(202);
    const third = await client.resendVerification(uniqueEmail('ip3'));
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('AC-14 / NFR-S15: identical resend responses for every address', () => {
  useMigratedDb();
  const { app, clock, mail, emailsSettled } = createHarness();

  it('answers unknown, unverified and verified addresses the same way', async () => {
    const unknown = uniqueEmail('unknown');
    const unverified = uniqueEmail('unverified');
    const verified = uniqueEmail('verified');
    await (await new TestClient(app).init()).signup(unverified);
    await createVerifiedUser(app, verified);
    clock.advance(MINUTE + SECOND);
    await emailsSettled();
    const before = mail.sent.length;

    const addresses = [unknown, unverified, verified];
    const resend = (email: string) =>
      new TestClient(app).init().then((client) => client.resendVerification(email));
    const first = await Promise.all(addresses.map(resend));
    const second = await Promise.all(addresses.map(resend));

    const [firstUnknown, ...firstOthers] = first.map(comparable);
    const [secondUnknown, ...secondOthers] = second.map(comparable);
    for (const res of firstOthers) expect(res).toEqual(firstUnknown);
    for (const res of secondOthers) expect(res).toEqual(secondUnknown);
    expect(firstUnknown?.status).toBe(202);
    expect(secondUnknown?.status).toBe(429);

    // Only the unverified account actually received an email.
    await emailsSettled();
    expect(mail.sent.slice(before).map((message) => message.to)).toEqual([unverified]);
  });
});

describe('OQ-21: signup with an address that already has an account', () => {
  useMigratedDb();
  const { app, clock, mail, emailsSettled } = createHarness();

  it('newest signup wins for an unverified account: new password, link and sessions', async () => {
    const email = uniqueEmail('reclaim');
    const squatter = await new TestClient(app).init();
    await squatter.signup(email, OTHER_STRONG_PASSWORD, { name: 'Squatter' });
    await squatter.login(email, OTHER_STRONG_PASSWORD);
    await emailsSettled();
    const squatterToken = mail.latestToken(email);

    clock.advance(MINUTE + SECOND);
    const owner = await new TestClient(app).init();
    expect((await owner.signup(email, STRONG_PASSWORD, { name: 'Owner' })).status).toBe(202);
    await emailsSettled();

    expect((await squatter.me()).status).toBe(401); // earlier sessions ended
    expect((await owner.verifyEmail(squatterToken)).status).toBe(400); // earlier link dead
    const verified = await owner.verifyEmail(mail.latestToken(email));
    expect(verified.status).toBe(200);
    expect(verified.body.user.name).toBe('Owner');

    // A fresh CSRF token, as the web app fetches after a 401 (the old one was session-bound).
    await squatter.init();
    expect((await squatter.login(email, OTHER_STRONG_PASSWORD)).status).toBe(401);
    expect((await (await new TestClient(app).init()).login(email)).status).toBe(200);
  });

  it('treats a "$" in the name as text, not a field path', async () => {
    const email = uniqueEmail('literal');
    await (await new TestClient(app).init()).signup(email);
    clock.advance(MINUTE + SECOND);
    await (await new TestClient(app).init()).signup(email, STRONG_PASSWORD, { name: '$email' });
    expect((await UserModel.findOne({ email }).lean())?.name).toBe('$email');
  });

  it('leaves a verified account alone and sends nothing', async () => {
    const email = uniqueEmail('taken');
    await createVerifiedUser(app, email);
    await emailsSettled();
    const before = await UserModel.findOne({ email }).select('+passwordHash').lean();
    const sent = mail.to(email).length;

    clock.advance(MINUTE + SECOND);
    const res = await (await new TestClient(app).init()).signup(email, OTHER_STRONG_PASSWORD);
    expect(res.status).toBe(202);
    await emailsSettled();
    expect(mail.to(email)).toHaveLength(sent);
    expect(await UserModel.findOne({ email }).select('+passwordHash').lean()).toEqual(before);
  });
});

describe('NFR-A4: email delivery retries', () => {
  useMigratedDb();
  const { app, mail, retryDelays, emailsSettled } = createHarness();

  it('retries with exponential backoff and still answers the request at once', async () => {
    mail.failures = [new Error('network down'), new Error('network down')];
    const email = uniqueEmail('retry');
    const res = await (await new TestClient(app).init()).signup(email);
    expect(res.status).toBe(202);
    await emailsSettled();
    expect(mail.to(email)).toHaveLength(1);
    expect(retryDelays).toEqual([1000, 2000]);
  });
});
