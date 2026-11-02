import { RESOURCE_LIMITS } from '../../shared/index.js';
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { useMigratedDb } from '../../../test/migrated-db.js';
import { validationErrors } from '../../../test/validation.js';
import { ResourceModel } from './resource.model.js';

const base = () => ({
  userId: new Types.ObjectId(),
  url: 'https://example.com/a',
  title: 'Example',
});

describe('ResourceModel validation (SRS 5.2, FR-R1)', () => {
  it('applies defaults', async () => {
    const resource = new ResourceModel(base());
    expect(await validationErrors(resource)).toBeUndefined();
    expect(resource.note).toBe('');
    expect([...resource.tags]).toEqual([]);
    expect(resource.isPinned).toBe(false);
    expect(resource.pinnedAt).toBeNull();
  });

  it('lowercases and trims tags', () => {
    const resource = new ResourceModel({ ...base(), tags: [' React ', 'TS'] });
    expect([...resource.tags]).toEqual(['react', 'ts']);
  });

  it.each([
    ['url', 'javascript:alert(1)'],
    ['url', 'ftp://example.com'],
    ['url', `https://example.com/${'a'.repeat(RESOURCE_LIMITS.urlMax)}`],
    ['url', undefined],
    ['title', undefined],
    ['title', '   '],
    ['title', 'x'.repeat(RESOURCE_LIMITS.titleMax + 1)],
    ['note', 'x'.repeat(RESOURCE_LIMITS.noteMax + 1)],
    ['userId', undefined],
  ])('rejects %s = %j', async (field, value) => {
    const resource = new ResourceModel({ ...base(), [field]: value });
    expect((await validationErrors(resource))?.[field]).toBeDefined();
  });

  it('limits tags to 10, each 1 to 30 characters', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `t${i}`);
    expect(
      (await validationErrors(new ResourceModel({ ...base(), tags: eleven })))?.tags,
    ).toBeDefined();

    const long = new ResourceModel({ ...base(), tags: ['x'.repeat(RESOURCE_LIMITS.tagMax + 1)] });
    expect(await validationErrors(long)).toBeDefined();

    const ten = Array.from(
      { length: 10 },
      (_, i) => `${'x'.repeat(RESOURCE_LIMITS.tagMax - 1)}${i}`,
    );
    expect(await validationErrors(new ResourceModel({ ...base(), tags: ten }))).toBeUndefined();
  });

  it('keeps pinnedAt consistent with isPinned (FR-L1, FR-C1)', async () => {
    await expect(new ResourceModel({ ...base(), isPinned: true }).validate()).rejects.toThrow(
      /pinnedAt is required/,
    );
    await expect(
      new ResourceModel({ ...base(), isPinned: false, pinnedAt: new Date() }).validate(),
    ).rejects.toThrow(/pinnedAt must be null/);
    await expect(
      new ResourceModel({ ...base(), isPinned: true, pinnedAt: new Date() }).validate(),
    ).resolves.toBeUndefined();
  });

  it('rejects unknown fields', () => {
    expect(() => new ResourceModel({ ...base(), favicon: 'x' })).toThrow();
  });
});

describe('ResourceModel with the database', () => {
  useMigratedDb();

  it('sets timestamps and keeps userId immutable (NFR-S4)', async () => {
    const ownerId = new Types.ObjectId();
    const created = await ResourceModel.create({ ...base(), userId: ownerId });
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);

    await ResourceModel.updateOne({ _id: created._id }, { $set: { userId: new Types.ObjectId() } });
    const reloaded = await ResourceModel.findById(created._id).lean();
    expect(reloaded?.userId.equals(ownerId)).toBe(true);
  });

  it('allows the same URL twice for one user (FR-R7)', async () => {
    const userId = new Types.ObjectId();
    await ResourceModel.create({ ...base(), userId });
    await expect(ResourceModel.create({ ...base(), userId })).resolves.toBeDefined();
    expect(await ResourceModel.countDocuments({ userId })).toBe(2);
  });

  it('searches title, note, tags and url through the text index (FR-L2)', async () => {
    const userId = new Types.ObjectId();
    await ResourceModel.create([
      { userId, url: 'https://a.io/x', title: 'Quantum notes' },
      { userId, url: 'https://b.io/x', title: 'B', note: 'about quantum computing' },
      { userId, url: 'https://c.io/x', title: 'C', tags: ['quantum'] },
      { userId, url: 'https://quantum.io/x', title: 'D' },
      { userId, url: 'https://e.io/x', title: 'Unrelated' },
    ]);
    const hits = await ResourceModel.find({ userId, $text: { $search: 'quantum' } }).lean();
    expect(hits.map((hit) => hit.title).sort()).toEqual(['B', 'C', 'D', 'Quantum notes']);
  });

  it('serves the library sort from the library_order index (FR-L1)', async () => {
    const plan: unknown = await ResourceModel.find({ userId: new Types.ObjectId() })
      .sort({ isPinned: -1, pinnedAt: -1, createdAt: -1 })
      .explain('queryPlanner');
    expect(JSON.stringify(plan)).toContain('library_order');
  });
});
