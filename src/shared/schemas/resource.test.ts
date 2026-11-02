import { describe, expect, it } from 'vitest';
import { RESOURCE_LIMITS } from '../constants.js';
import {
  createResourceSchema,
  listResourcesQuerySchema,
  resourceUrlSchema,
  tagsSchema,
  updateResourceSchema,
} from './resource.js';

describe('createResourceSchema (FR-R1, FR-R2, FR-U3)', () => {
  it('normalizes the URL and defaults a missing title to the hostname', () => {
    const parsed = createResourceSchema.parse({ url: ' docs.example.com/guide ' });
    expect(parsed).toEqual({
      url: 'https://docs.example.com/guide',
      title: 'docs.example.com',
      tags: [],
    });
  });

  it('defaults a blank title to the hostname', () => {
    const parsed = createResourceSchema.parse({ url: 'https://example.com', title: '   ' });
    expect(parsed.title).toBe('example.com');
  });

  it('keeps a provided title, trimmed', () => {
    const parsed = createResourceSchema.parse({ url: 'https://example.com', title: ' Docs ' });
    expect(parsed.title).toBe('Docs');
  });

  it('rejects non-http(s) URLs with a readable message (AC-9)', () => {
    const result = createResourceSchema.safeParse({ url: 'javascript:alert(1)' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Only http and https links can be saved.');
  });

  it.each([
    ['title', 'x'.repeat(RESOURCE_LIMITS.titleMax + 1)],
    ['note', 'x'.repeat(RESOURCE_LIMITS.noteMax + 1)],
  ])('rejects an over-long %s', (field, value) => {
    expect(createResourceSchema.safeParse({ url: 'https://a.io', [field]: value }).success).toBe(
      false,
    );
  });

  it('accepts a note at the limit', () => {
    const note = 'x'.repeat(RESOURCE_LIMITS.noteMax);
    expect(createResourceSchema.parse({ url: 'https://a.io', note }).note).toBe(note);
  });

  it('rejects unknown keys such as userId or pinnedAt (NFR-S4)', () => {
    expect(createResourceSchema.safeParse({ url: 'https://a.io', userId: 'x' }).success).toBe(
      false,
    );
    expect(createResourceSchema.safeParse({ url: 'https://a.io', pinnedAt: 'x' }).success).toBe(
      false,
    );
  });
});

describe('tagsSchema (FR-R1)', () => {
  it('lowercases, trims and de-duplicates tags', () => {
    expect(tagsSchema.parse([' React ', 'react', 'TS'])).toEqual(['react', 'ts']);
  });

  it('rejects more than 10 tags, empty tags and tags over 30 characters', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `t${i}`);
    expect(tagsSchema.safeParse(eleven).success).toBe(false);
    expect(tagsSchema.safeParse(['  ']).success).toBe(false);
    expect(tagsSchema.safeParse(['x'.repeat(RESOURCE_LIMITS.tagMax + 1)]).success).toBe(false);
    expect(tagsSchema.safeParse(['x'.repeat(RESOURCE_LIMITS.tagMax)]).success).toBe(true);
  });
});

describe('resourceUrlSchema', () => {
  it.each(['', 'ftp://a.io', 'hello', `https://a.io/${'x'.repeat(RESOURCE_LIMITS.urlMax)}`])(
    'rejects %j',
    (url) => {
      expect(resourceUrlSchema.safeParse(url).success).toBe(false);
    },
  );
});

describe('updateResourceSchema (FR-R3, FR-C1)', () => {
  it('accepts a pin toggle on its own', () => {
    expect(updateResourceSchema.parse({ isPinned: true })).toEqual({ isPinned: true });
  });

  it('rejects an empty update and client-supplied pinnedAt', () => {
    expect(updateResourceSchema.safeParse({}).success).toBe(false);
    expect(updateResourceSchema.safeParse({ pinnedAt: new Date().toISOString() }).success).toBe(
      false,
    );
  });

  it('validates a changed URL', () => {
    expect(updateResourceSchema.safeParse({ url: 'mailto:a@b.co' }).success).toBe(false);
    expect(updateResourceSchema.parse({ url: 'a.io' }).url).toBe('https://a.io');
  });
});

describe('listResourcesQuerySchema (FR-L2 to FR-L5)', () => {
  it('applies the 50-item default page size', () => {
    expect(listResourcesQuerySchema.parse({})).toEqual({ limit: 50 });
  });

  it('turns single or repeated tag params into a de-duplicated list (AND filter)', () => {
    expect(listResourcesQuerySchema.parse({ tag: 'React' }).tag).toEqual(['react']);
    expect(listResourcesQuerySchema.parse({ tag: ['a', 'B', 'a'] }).tag).toEqual(['a', 'b']);
  });

  it('parses pinned and limit from query strings', () => {
    const parsed = listResourcesQuerySchema.parse({ pinned: 'true', limit: '10' });
    expect(parsed).toMatchObject({ pinned: true, limit: 10 });
    expect(listResourcesQuerySchema.parse({ pinned: 'false' }).pinned).toBe(false);
  });

  it('rejects limits above 50 and unknown parameters', () => {
    expect(listResourcesQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(listResourcesQuerySchema.safeParse({ userId: 'x' }).success).toBe(false);
    expect(listResourcesQuerySchema.safeParse({ pinned: 'yes' }).success).toBe(false);
  });
});
