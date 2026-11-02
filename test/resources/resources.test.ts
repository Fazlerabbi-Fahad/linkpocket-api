import type { ResourceDto, ResourceList } from '../../src/shared/index.js';
import { describe, expect, it } from 'vitest';
import { ResourceModel, UserModel } from '../../src/db/models/index.js';
import { useMigratedDb } from '../migrated-db.js';
import { TestClient, createHarness, loggedInClient, uniqueEmail } from '../harness.js';

const R = '/api/v1/resources';

interface ResourceBody {
  resource: ResourceDto;
  duplicate: boolean;
}

function bodyOf<T>(res: { body: unknown }): T {
  return res.body as T;
}

async function save(client: TestClient, body: Record<string, unknown>): Promise<ResourceDto> {
  const res = await client.send('post', R, body);
  if (res.status !== 201) throw new Error(`create failed: ${res.status}`);
  return bodyOf<ResourceBody>(res).resource;
}

async function list(client: TestClient, query = ''): Promise<ResourceList> {
  const res = await client.send('get', `${R}${query}`);
  if (res.status !== 200) throw new Error(`list failed: ${res.status}`);
  return bodyOf<ResourceList>(res);
}

const titles = (page: ResourceList) => page.items.map((item) => item.title);

describe('POST /resources (FR-R1, FR-R2, FR-U2, FR-R7)', () => {
  useMigratedDb();
  const { app } = createHarness();

  it('saves a resource with normalized URL, default title and clean tags', async () => {
    const client = await loggedInClient(app, uniqueEmail('create'));
    const res = await client.send('post', R, {
      url: '  docs.example.com/guide?q=1  ',
      note: 'Read later',
      tags: ['Docs', 'docs', ' Guides '],
    });
    expect(res.status).toBe(201);
    const { resource, duplicate } = bodyOf<ResourceBody>(res);
    expect(duplicate).toBe(false);
    expect(resource).toMatchObject({
      url: 'https://docs.example.com/guide?q=1',
      title: 'docs.example.com',
      note: 'Read later',
      tags: ['docs', 'guides'],
      isPinned: false,
      pinnedAt: null,
    });
    expect(resource.id).toMatch(/^[a-f0-9]{24}$/);
    expect(Object.keys(resource).sort()).toEqual(
      [
        'createdAt',
        'id',
        'isPinned',
        'note',
        'pinnedAt',
        'tags',
        'title',
        'updatedAt',
        'url',
      ].sort(),
    );
  });

  it('keeps the URL exactly as typed, apart from trimming (OQ-17)', async () => {
    const client = await loggedInClient(app, uniqueEmail('exact'));
    const resource = await save(client, { url: 'https://Example.com/Path#Frag', title: 'T' });
    expect(resource.url).toBe('https://Example.com/Path#Frag');
  });

  it('saves duplicates and flags them, including spelling variants (FR-R7)', async () => {
    const client = await loggedInClient(app, uniqueEmail('dup'));
    await save(client, { url: 'https://example.com', title: 'First' });
    for (const url of ['https://example.com', 'example.com', 'https://EXAMPLE.com/']) {
      const res = await client.send('post', R, { url });
      expect(res.status).toBe(201);
      expect(bodyOf<ResourceBody>(res).duplicate).toBe(true);
    }
    expect(
      bodyOf<ResourceBody>(await client.send('post', R, { url: 'example.org' })).duplicate,
    ).toBe(false);
    expect((await list(client)).items).toHaveLength(5);
  });

  it.each([
    ['userId', { userId: '0123456789abcdef01234567' }],
    ['pinnedAt', { pinnedAt: new Date().toISOString() }],
    ['isPinned', { isPinned: true }],
  ])('rejects a client-supplied %s (NFR-S4)', async (_label, extra) => {
    const client = await loggedInClient(app, uniqueEmail('extra'));
    const res = await client.send('post', R, { url: 'example.com', ...extra });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect((await list(client)).items).toHaveLength(0);
  });

  it.each([
    ['a note over 1000 characters', { note: 'n'.repeat(1001) }, 'note'],
    ['a title over 300 characters', { title: 't'.repeat(301) }, 'title'],
    ['more than 10 tags', { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }, 'tags'],
    ['a tag over 30 characters', { tags: ['x'.repeat(31)] }, 'tags.0'],
    ['an empty tag', { tags: ['  '] }, 'tags.0'],
  ])('rejects %s (FR-R1)', async (_label, extra, path) => {
    const client = await loggedInClient(app, uniqueEmail('limits'));
    const res = await client.send('post', R, { url: 'example.com', ...extra });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.fields.map((field) => field.path)).toContain(path);
  });

  it('requires the CSRF header (NFR-S10)', async () => {
    const client = await loggedInClient(app, uniqueEmail('csrf'));
    const res = await client.send('post', R, { url: 'example.com' }, { csrf: false });
    expect(res.status).toBe(403);
  });
});

describe('AC-9 / FR-U1: only http and https URLs', () => {
  useMigratedDb();
  const { app } = createHarness();

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://files.example.com/a',
    'mailto:someone@example.com',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
    'hello',
    '   ',
    `https://example.com/${'a'.repeat(2048)}`,
  ])('rejects %s on create and update', async (url) => {
    const client = await loggedInClient(app, uniqueEmail('scheme'));
    const created = await client.send('post', R, { url });
    expect(created.status).toBe(400);
    expect(created.body.error.code).toBe('INVALID_URL');
    expect(created.body.error.fields[0]?.path).toBe('url');

    const resource = await save(client, { url: 'https://example.com/ok' });
    const updated = await client.send('patch', `${R}/${resource.id}`, { url });
    expect(updated.status).toBe(400);
    expect(updated.body.error.code).toBe('INVALID_URL');
    expect((await ResourceModel.findById(resource.id).lean())?.url).toBe('https://example.com/ok');
    expect(await ResourceModel.countDocuments({ url })).toBe(0);
  });

  it.each(['http://example.com', 'https://example.com:8443/a', 'localhost:3000/x'])(
    'accepts %s',
    async (url) => {
      const client = await loggedInClient(app, uniqueEmail('ok'));
      expect((await client.send('post', R, { url })).status).toBe(201);
    },
  );
});

describe('GET, PATCH, DELETE /resources/:id (FR-R3, FR-R4, FR-C1)', () => {
  useMigratedDb();
  const { app, clock } = createHarness();

  it('returns an owned resource', async () => {
    const client = await loggedInClient(app, uniqueEmail('get'));
    const resource = await save(client, { url: 'example.com', title: 'Mine' });
    const res = await client.send('get', `${R}/${resource.id}`);
    expect(res.status).toBe(200);
    expect(bodyOf<{ resource: ResourceDto }>(res).resource).toEqual(resource);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each(['not-an-id', '0123456789abcdef0123456z', '0123456789abcdef01234567'])(
    'answers 404 for %s',
    async (id) => {
      const client = await loggedInClient(app, uniqueEmail('missing'));
      for (const method of ['get', 'patch', 'delete'] as const) {
        const res = await client.send(
          method,
          `${R}/${id}`,
          method === 'patch' ? { note: 'x' } : undefined,
        );
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
    },
  );

  it('edits every field; a blank title becomes the hostname (FR-R2)', async () => {
    const client = await loggedInClient(app, uniqueEmail('edit'));
    const resource = await save(client, { url: 'example.com', title: 'Old', tags: ['a'] });
    const res = await client.send('patch', `${R}/${resource.id}`, {
      url: 'news.example.org/today',
      title: '',
      note: 'updated',
      tags: ['B', 'c'],
    });
    expect(res.status).toBe(200);
    expect(bodyOf<{ resource: ResourceDto }>(res).resource).toMatchObject({
      url: 'https://news.example.org/today',
      title: 'news.example.org',
      note: 'updated',
      tags: ['b', 'c'],
    });
  });

  it('pins with a server-set pinnedAt and unpins by clearing it (FR-C1)', async () => {
    const client = await loggedInClient(app, uniqueEmail('pin'));
    const resource = await save(client, { url: 'example.com' });
    const path = `${R}/${resource.id}`;

    const pinned = bodyOf<{ resource: ResourceDto }>(
      await client.send('patch', path, { isPinned: true }),
    ).resource;
    expect(pinned.isPinned).toBe(true);
    expect(pinned.pinnedAt).toBe(clock.now().toISOString());

    clock.advance(60_000);
    const again = bodyOf<{ resource: ResourceDto }>(
      await client.send('patch', path, { isPinned: true }),
    ).resource;
    expect(again.pinnedAt).toBe(pinned.pinnedAt); // pinning twice keeps the original time

    const unpinned = bodyOf<{ resource: ResourceDto }>(
      await client.send('patch', path, { isPinned: false }),
    ).resource;
    expect(unpinned).toMatchObject({ isPinned: false, pinnedAt: null });
  });

  it.each([
    ['an empty body', {}],
    ['a client-supplied pinnedAt', { pinnedAt: new Date().toISOString() }],
    ['a client-supplied userId', { userId: '0123456789abcdef01234567' }],
  ])('rejects %s', async (_label, body) => {
    const client = await loggedInClient(app, uniqueEmail('badpatch'));
    const resource = await save(client, { url: 'example.com' });
    const res = await client.send('patch', `${R}/${resource.id}`, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('deletes permanently (FR-R4)', async () => {
    const client = await loggedInClient(app, uniqueEmail('delete'));
    const resource = await save(client, { url: 'example.com' });
    expect((await client.send('delete', `${R}/${resource.id}`)).status).toBe(204);
    expect(await ResourceModel.exists({ _id: resource.id })).toBeNull();
    expect((await client.send('get', `${R}/${resource.id}`)).status).toBe(404);
    expect((await client.send('delete', `${R}/${resource.id}`)).status).toBe(404);
  });
});

describe('GET /resources: order, filters, search, pagination (FR-L1 to FR-L5)', () => {
  useMigratedDb();
  const { app, clock } = createHarness();

  it('lists pinned first (most recently pinned first), then newest saved', async () => {
    const client = await loggedInClient(app, uniqueEmail('order'));
    const a = await save(client, { url: 'a.example.com', title: 'A' });
    await save(client, { url: 'b.example.com', title: 'B' });
    const c = await save(client, { url: 'c.example.com', title: 'C' });
    await save(client, { url: 'd.example.com', title: 'D' });

    await client.send('patch', `${R}/${a.id}`, { isPinned: true });
    clock.advance(1000);
    await client.send('patch', `${R}/${c.id}`, { isPinned: true });
    expect(titles(await list(client))).toEqual(['C', 'A', 'D', 'B']);

    await client.send('patch', `${R}/${c.id}`, { isPinned: false });
    expect(titles(await list(client))).toEqual(['A', 'D', 'C', 'B']);
  });

  it('pages with a cursor, without gaps or repeats, across the pinned boundary', async () => {
    const client = await loggedInClient(app, uniqueEmail('pages'));
    const saved: ResourceDto[] = [];
    for (let i = 0; i < 8; i += 1)
      saved.push(await save(client, { url: `p${i}.example.com`, title: `P${i}` }));
    for (const index of [1, 5]) {
      clock.advance(1000);
      await client.send('patch', `${R}/${saved[index]?.id ?? ''}`, { isPinned: true });
    }

    const full = titles(await list(client));
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = cursor ? `?limit=3&cursor=${cursor}` : '?limit=3';
      const page = await list(client, query);
      seen.push(...titles(page));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toEqual(full);
    expect(full.slice(0, 2)).toEqual(['P5', 'P1']);
  });

  it('defaults to 50 per page and refuses more (FR-L5)', async () => {
    const email = uniqueEmail('fifty');
    const client = await loggedInClient(app, email);
    const user = await UserModel.findOne({ email }).lean();
    await ResourceModel.insertMany(
      Array.from({ length: 55 }, (_, i) => ({
        userId: user?._id,
        url: `https://bulk.example.com/${i}`,
        title: `Bulk ${i}`,
      })),
    );
    const first = await list(client);
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const second = await list(client, `?cursor=${first.nextCursor ?? ''}`);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();

    expect((await client.send('get', `${R}?limit=51`)).status).toBe(400);
  });

  it.each(['not-base64!', Buffer.from('{"p":true}').toString('base64url'), 'e30'])(
    'rejects a malformed cursor %s',
    async (cursor) => {
      const client = await loggedInClient(app, uniqueEmail('cursor'));
      const res = await client.send('get', `${R}?cursor=${cursor}`);
      expect(res.status).toBe(400);
      expect(res.body.error.fields[0]?.path).toBe('cursor');
    },
  );

  it('searches title, URL, note and tags as case-insensitive substrings (FR-L2, OQ-6)', async () => {
    const client = await loggedInClient(app, uniqueEmail('search'));
    await save(client, { url: 'github.com/acme/repo', title: 'Repo' });
    await save(client, { url: 'example.com/1', title: 'Learning TypeScript' });
    await save(client, { url: 'example.com/2', title: 'Two', note: 'mentions GITHUB actions' });
    await save(client, { url: 'example.com/3', title: 'Three', tags: ['git-tips'] });
    await save(client, { url: 'example.com/4', title: 'C++ basics' });

    expect(titles(await list(client, '?q=git')).sort()).toEqual(['Repo', 'Three', 'Two']);
    expect(titles(await list(client, '?q=typescript'))).toEqual(['Learning TypeScript']);
    // Regex characters are matched literally.
    expect(titles(await list(client, `?q=${encodeURIComponent('c++')}`))).toEqual(['C++ basics']);
    expect(titles(await list(client, '?q=.*'))).toEqual([]);
  });

  it('filters by tags with AND, and by pinned status (FR-L3, FR-L4)', async () => {
    const client = await loggedInClient(app, uniqueEmail('filter'));
    await save(client, { url: 'example.com/1', title: 'Both', tags: ['work', 'read'] });
    const work = await save(client, { url: 'example.com/2', title: 'Work', tags: ['work'] });
    await save(client, { url: 'example.com/3', title: 'None' });
    await client.send('patch', `${R}/${work.id}`, { isPinned: true });

    expect(titles(await list(client, '?tag=work')).sort()).toEqual(['Both', 'Work']);
    expect(titles(await list(client, '?tag=work&tag=READ'))).toEqual(['Both']);
    expect(titles(await list(client, '?pinned=true'))).toEqual(['Work']);
    expect(titles(await list(client, '?pinned=false')).sort()).toEqual(['Both', 'None']);
    expect(titles(await list(client, '?pinned=false&tag=work&q=bo'))).toEqual(['Both']);
  });

  it.each(['?unknown=1', '?pinned=yes', '?tag=', `?q=${'q'.repeat(201)}`])(
    'rejects the query %s',
    async (query) => {
      const client = await loggedInClient(app, uniqueEmail('query'));
      const res = await client.send('get', `${R}${query}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    },
  );

  it('returns an empty first page for a new user (FR-L6)', async () => {
    const client = await loggedInClient(app, uniqueEmail('empty'));
    expect(await list(client)).toEqual({ items: [], nextCursor: null });
  });
});

describe('resource endpoints need a session', () => {
  useMigratedDb();
  const { app } = createHarness();

  it('answers 401 without one', async () => {
    const res = await (await new TestClient(app).init()).send('get', R);
    expect(res.status).toBe(401);
  });
});
