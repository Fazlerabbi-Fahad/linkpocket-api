import { describe, expect, it } from 'vitest';
import { UserModel } from '../../src/db/models/index.js';
import { useMigratedDb } from '../migrated-db.js';
import {
  STRONG_PASSWORD,
  TestClient,
  createHarness,
  loggedInClient,
  testConfig,
  uniqueEmail,
  type ApiResponse,
} from '../harness.js';

const STATS = '/api/v1/admin/stats';
const USERS = '/api/v1/admin/users';
const status = (id: string) => `/api/v1/admin/users/${id}/status`;

async function idOf(email: string): Promise<string> {
  const user = await UserModel.findOne({ email }).lean();
  if (!user) throw new Error('missing user');
  return user._id.toHexString();
}

/** AC-10, FR-AD1, FR-AD2, NFR-S5: the role is checked on the server for every admin request. */
describe('AC-10: admin endpoints by role', () => {
  useMigratedDb();
  const { app } = createHarness();

  async function callAll(client: TestClient, targetId: string): Promise<ApiResponse[]> {
    return [
      await client.send('get', STATS),
      await client.send('get', USERS),
      await client.send('patch', status(targetId), {
        status: 'disabled',
        password: STRONG_PASSWORD,
      }),
    ];
  }

  async function target() {
    const email = uniqueEmail('target');
    await loggedInClient(app, email);
    return { email, id: await idOf(email) };
  }

  it('signed-out callers get 401', async () => {
    const t = await target();
    const anonymous = await new TestClient(app).init();
    for (const res of await callAll(anonymous, t.id)) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('verified users who are not admins get 403 and change nothing', async () => {
    const t = await target();
    const user = await loggedInClient(app, uniqueEmail('plain'));
    for (const res of await callAll(user, t.id)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect((await UserModel.findById(t.id).lean())?.status).toBe('active');
  });

  it('admins who have not verified their email get 403 (FR-AD10)', async () => {
    const t = await target();
    const email = uniqueEmail('unverified-admin');
    const client = await new TestClient(app).init();
    expect((await client.signup(email)).status).toBe(202);
    await UserModel.updateOne({ email }, { $set: { role: 'admin' } });
    expect((await client.login(email)).status).toBe(200);
    for (const res of await callAll(client, t.id)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    }
  });

  it('verified admins get through', async () => {
    const admin = await loggedInClient(app, uniqueEmail('admin'), STRONG_PASSWORD, 'admin');
    expect((await admin.send('get', STATS)).status).toBe(200);
    expect((await admin.send('get', USERS)).status).toBe(200);
  });

  it('losing the role takes effect on the very next request', async () => {
    const email = uniqueEmail('demoted');
    const admin = await loggedInClient(app, email, STRONG_PASSWORD, 'admin');
    expect((await admin.send('get', STATS)).status).toBe(200);
    await UserModel.updateOne({ email }, { $set: { role: 'user' } });
    const res = await admin.send('get', STATS);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('a disabled admin is refused', async () => {
    const email = uniqueEmail('disabled-admin');
    const admin = await loggedInClient(app, email, STRONG_PASSWORD, 'admin');
    await UserModel.updateOne({ email }, { $set: { status: 'disabled' } });
    const res = await admin.send('get', STATS);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('admin responses are never cached', async () => {
    const admin = await loggedInClient(app, uniqueEmail('cache'), STRONG_PASSWORD, 'admin');
    expect((await admin.send('get', STATS)).headers['cache-control']).toBe('no-store');
  });
});

describe('admin rate limits (NFR-S14)', () => {
  useMigratedDb();
  const base = testConfig();
  const { app } = createHarness({
    rateLimits: {
      ...base.rateLimits,
      admin: { windowMs: 60_000, limit: 3 },
      adminStatus: { windowMs: 60_000, limit: 1 },
    },
  });

  it('limits every admin endpoint, and status changes more tightly', async () => {
    const admin = await loggedInClient(app, uniqueEmail('limited'), STRONG_PASSWORD, 'admin');
    const targetEmail = uniqueEmail('limited-target');
    await loggedInClient(app, targetEmail);
    const id = await idOf(targetEmail);
    const body = { status: 'disabled', password: STRONG_PASSWORD };

    expect((await admin.send('patch', status(id), body)).status).toBe(200);
    const second = await admin.send('patch', status(id), body);
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('RATE_LIMITED');

    expect((await admin.send('get', STATS)).status).toBe(200);
    expect((await admin.send('get', STATS)).status).toBe(429);
  });
});
