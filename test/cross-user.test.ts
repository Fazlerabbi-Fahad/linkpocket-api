import { accountExportSchema, type ResourceDto, type ResourceList } from '../src/shared/index.js';
import { describe, expect, it } from 'vitest';
import { ResourceModel, UserModel } from '../src/db/models/index.js';
import { encodeCursor } from '../src/resources/cursor.js';
import { useMigratedDb } from './migrated-db.js';
import {
  STRONG_PASSWORD,
  comparable,
  createHarness,
  loggedInClient,
  uniqueEmail,
  type ApiResponse,
} from './harness.js';

/**
 * AC-8, FR-R6, NFR-S4, SRS 5.4: one user can never read, change or delete another user's
 * data, on any resource or account endpoint. Another user's resource answers exactly like
 * an id that does not exist.
 */
describe('cross-user access', () => {
  useMigratedDb();
  const { app } = createHarness();

  async function setup() {
    const aliceEmail = uniqueEmail('alice');
    const bobEmail = uniqueEmail('bob');
    const alice = await loggedInClient(app, aliceEmail);
    const bob = await loggedInClient(app, bobEmail);
    const created = await bob.send('post', '/api/v1/resources', {
      url: 'https://bob.example.com/secret-plan',
      title: 'Bob secret plan',
      note: 'private note',
      tags: ['bob-only'],
    });
    const bobs = (created.body as unknown as { resource: ResourceDto }).resource;
    await bob.send('patch', `/api/v1/resources/${bobs.id}`, { isPinned: true });
    const pinned = await ResourceModel.findById(bobs.id).lean();
    const before = JSON.stringify(pinned);
    return { alice, bob, aliceEmail, bobEmail, bobs, before };
  }

  const missingId = '0123456789abcdef01234567';

  it.each([
    ['get', undefined],
    ['patch', { title: 'Taken over' }],
    ['patch', { isPinned: false }],
    ['delete', undefined],
  ] as const)(
    "AC-8: %s on another user's resource answers like a missing one (%j)",
    async (method, body) => {
      const { alice, bobs, before } = await setup();
      const theirs: ApiResponse = await alice.send(method, `/api/v1/resources/${bobs.id}`, body);
      const missing: ApiResponse = await alice.send(method, `/api/v1/resources/${missingId}`, body);

      expect(theirs.status).toBe(404);
      expect(theirs.body.error.code).toBe('NOT_FOUND');
      expect(comparable(theirs)).toEqual(comparable(missing));
      // Unchanged in the database.
      expect(JSON.stringify(await ResourceModel.findById(bobs.id).lean())).toBe(before);
    },
  );

  it("AC-8: list, search, tag and pinned filters never return another user's resources", async () => {
    const { alice, bobs } = await setup();
    await alice.send('post', '/api/v1/resources', { url: 'alice.example.com', title: 'Alice' });
    for (const query of ['', '?q=secret', '?q=bob', '?tag=bob-only', '?pinned=true', '?limit=50']) {
      const res = await alice.send('get', `/api/v1/resources${query}`);
      expect(res.status).toBe(200);
      const ids = (res.body as unknown as ResourceList).items.map((item) => item.id);
      expect(ids).not.toContain(bobs.id);
      expect(JSON.stringify(res.body)).not.toContain('secret-plan');
    }
  });

  it("AC-8: a cursor built from another user's resource only pages through your own", async () => {
    const { alice, bobs } = await setup();
    await alice.send('post', '/api/v1/resources', { url: 'alice.example.com', title: 'Alice' });
    const theirs = await ResourceModel.findById(bobs.id).lean();
    if (!theirs) throw new Error('missing');
    const cursor = encodeCursor({ ...theirs, isPinned: true });
    const res = await alice.send('get', `/api/v1/resources?cursor=${cursor}`);
    expect(res.status).toBe(200);
    const page = res.body as unknown as ResourceList;
    expect(page.items.map((item) => item.title)).toEqual(['Alice']);
  });

  it('NFR-S4: a created resource always belongs to the session user', async () => {
    const { alice, aliceEmail, bobEmail } = await setup();
    const bob = await UserModel.findOne({ email: bobEmail }).lean();
    const spoof = await alice.send('post', '/api/v1/resources', {
      url: 'example.com',
      userId: bob?._id.toHexString(),
    });
    expect(spoof.status).toBe(400);

    const ok = await alice.send('post', '/api/v1/resources', { url: 'example.com' });
    const created = (ok.body as unknown as { resource: ResourceDto }).resource;
    const stored = await ResourceModel.findById(created.id).lean();
    const aliceUser = await UserModel.findOne({ email: aliceEmail }).lean();
    expect(stored?.userId.toHexString()).toBe(aliceUser?._id.toHexString());
  });

  it("export contains only the caller's own data", async () => {
    const { alice, aliceEmail, bobEmail } = await setup();
    await alice.send('post', '/api/v1/resources', { url: 'alice.example.com', title: 'Alice' });
    const res = await alice.send('get', '/api/v1/account/export');
    const data = accountExportSchema.parse(res.body);
    expect(data.account.email).toBe(aliceEmail);
    expect(data.resources.map((resource) => resource.title)).toEqual(['Alice']);
    expect(JSON.stringify(data)).not.toContain(bobEmail);
    expect(JSON.stringify(data)).not.toContain('secret-plan');
  });

  it("deleting an account leaves other users' accounts and resources alone", async () => {
    const { alice, bob, bobEmail, bobs, before } = await setup();
    expect(
      (await alice.send('delete', '/api/v1/account', { password: STRONG_PASSWORD })).status,
    ).toBe(204);
    expect(await UserModel.exists({ email: bobEmail })).not.toBeNull();
    expect(JSON.stringify(await ResourceModel.findById(bobs.id).lean())).toBe(before);
    expect((await bob.me()).status).toBe(200);
  });
});
