import { describe, expect, it } from 'vitest';
import { SIGNUP_RESPONSE } from '../../src/auth/auth-routes.js';
import { UserModel } from '../../src/db/models/index.js';
import { useMigratedDb } from '../migrated-db.js';
import { STRONG_PASSWORD, TestClient, comparable, createHarness, uniqueEmail } from '../harness.js';

describe('POST /auth/signup', () => {
  useMigratedDb();
  const { app, breach, clock } = createHarness();

  it('creates an unverified user with consent recorded and no session (FR-A1, NFR-PR4)', async () => {
    const client = await new TestClient(app).init();
    const email = uniqueEmail('new');
    const res = await client.signup(email.toUpperCase(), STRONG_PASSWORD, { name: ' Sam ' });

    expect(res.status).toBe(202);
    expect(res.body).toEqual(SIGNUP_RESPONSE);
    expect(res.headers['set-cookie']).toBeUndefined();

    const user = await UserModel.findOne({ email }).select('+passwordHash').lean();
    expect(user).toMatchObject({ email, name: 'Sam', role: 'user', emailVerifiedAt: null });
    expect(user?.privacyPolicyAcceptedAt).toEqual(clock.now());
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user?.passwordHash).not.toContain(STRONG_PASSWORD);
  });

  it('cannot create an admin through public signup (SRS 2.3)', async () => {
    const client = await new TestClient(app).init();
    const email = uniqueEmail('role');
    const res = await client.signup(email, STRONG_PASSWORD, { role: 'admin' });
    expect(res.status).toBe(400);
    expect(await UserModel.countDocuments({ email })).toBe(0);
  });

  it('requires privacy policy consent (NFR-PR4)', async () => {
    const client = await new TestClient(app).init();
    const res = await client.signup(uniqueEmail(), STRONG_PASSWORD, { acceptPrivacyPolicy: false });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  describe('password rules (FR-A10)', () => {
    it.each([
      ['too short', 'Ab1!xyz', 'VALIDATION_FAILED'],
      ['too long', 'x'.repeat(129), 'VALIDATION_FAILED'],
      ['common', 'password', 'PASSWORD_TOO_WEAK'],
      ['common, any case', 'IloveYou1', 'PASSWORD_TOO_WEAK'],
    ])('rejects a %s password', async (_label, password, code) => {
      const client = await new TestClient(app).init();
      const email = uniqueEmail('weak');
      const res = await client.signup(email, password);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(code);
      expect(await UserModel.countDocuments({ email })).toBe(0);
    });

    it('rejects a password found in a breach', async () => {
      breach.breached.add('breached-but-long-enough');
      const client = await new TestClient(app).init();
      const res = await client.signup(uniqueEmail('breach'), 'breached-but-long-enough');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({ code: 'PASSWORD_TOO_WEAK' });
      expect(res.body.error.fields[0]?.message).toMatch(/breach/);
    });

    it('accepts the password when the breach service is unreachable (fail open)', async () => {
      breach.result = 'unavailable';
      try {
        const client = await new TestClient(app).init();
        expect((await client.signup(uniqueEmail('open'))).status).toBe(202);
      } finally {
        breach.result = null;
      }
    });

    it('accepts 128 characters', async () => {
      const client = await new TestClient(app).init();
      expect((await client.signup(uniqueEmail('long'), 'k9'.repeat(64))).status).toBe(202);
    });
  });

  describe('AC-14 / NFR-S15: identical responses for new and existing addresses', () => {
    it('returns the same status, body and headers', async () => {
      const email = uniqueEmail('dup');
      const first = await (await new TestClient(app).init()).signup(email);
      const again = await (await new TestClient(app).init()).signup(email);
      const caseVariant = await (await new TestClient(app).init()).signup(email.toUpperCase());
      const fresh = await (await new TestClient(app).init()).signup(uniqueEmail('fresh'));

      expect(comparable(again)).toEqual(comparable(first));
      expect(comparable(caseVariant)).toEqual(comparable(first));
      expect(comparable(fresh)).toEqual(comparable(first));
      expect(await UserModel.countDocuments({ email })).toBe(1);
    });

    it('does not change the existing account within the FR-A4 resend interval', async () => {
      const email = uniqueEmail('keep');
      const client = await new TestClient(app).init();
      await client.signup(email, STRONG_PASSWORD, { name: 'Original' });
      const before = await UserModel.findOne({ email }).select('+passwordHash').lean();
      await client.signup(email, 'a-different-strong-pass-9', { name: 'Attacker' });
      const after = await UserModel.findOne({ email }).select('+passwordHash').lean();
      expect(after).toEqual(before);
    });
  });
});

describe('signup rate limit (NFR-S14)', () => {
  useMigratedDb();
  const { app } = createHarness({
    rateLimits: {
      global: { windowMs: 60_000, limit: 1000 },
      login: { windowMs: 60_000, limit: 1000 },
      signup: { windowMs: 60_000, limit: 2 },
      changePassword: { windowMs: 60_000, limit: 1000 },
      resendVerification: { windowMs: 60_000, limit: 1000 },
      verifyEmail: { windowMs: 60_000, limit: 1000 },
      accountExport: { windowMs: 60_000, limit: 1000 },
      accountDelete: { windowMs: 60_000, limit: 1000 },
      admin: { windowMs: 60_000, limit: 1000 },
      adminStatus: { windowMs: 60_000, limit: 1000 },
    },
  });

  it('returns 429 with the error envelope once the per-IP limit is reached', async () => {
    const client = await new TestClient(app).init();
    expect((await client.signup(uniqueEmail())).status).toBe(202);
    expect((await client.signup(uniqueEmail())).status).toBe(202);
    const blocked = await client.signup(uniqueEmail());
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatchObject({ code: 'RATE_LIMITED' });
    expect(blocked.body.error.requestId).toBe(blocked.headers['x-request-id']);
  });
});
