import { describe, expect, it } from 'vitest';
import { accountExportSchema } from './account.js';

const valid = {
  format: 'linkpocket-export',
  version: 1,
  exportedAt: '2026-11-01T00:00:00.000Z',
  account: {
    id: '0123456789abcdef01234567',
    email: 'person@example.com',
    name: null,
    role: 'user',
    emailVerifiedAt: '2026-11-01T00:00:00.000Z',
    privacyPolicyAcceptedAt: '2026-11-01T00:00:00.000Z',
    createdAt: '2026-11-01T00:00:00.000Z',
    lastLoginAt: null,
    lastActiveAt: null,
  },
  resources: [],
};

describe('accountExportSchema (FR-D1, AC-17 contract)', () => {
  it('accepts a well-formed export', () => {
    expect(accountExportSchema.parse(valid)).toEqual(valid);
  });

  it.each(['passwordHash', 'emailVerificationTokenHash', 'sessionVersion'])(
    'rejects an export that leaks %s',
    (field) => {
      const leaked = { ...valid, account: { ...valid.account, [field]: 'x' } };
      expect(accountExportSchema.safeParse(leaked).success).toBe(false);
    },
  );

  it('rejects resource fields outside the contract', () => {
    const resource = {
      id: 'r',
      url: 'https://example.com',
      title: 't',
      note: '',
      tags: [],
      isPinned: false,
      pinnedAt: null,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    };
    expect(accountExportSchema.safeParse({ ...valid, resources: [resource] }).success).toBe(true);
    expect(
      accountExportSchema.safeParse({ ...valid, resources: [{ ...resource, userId: 'u' }] })
        .success,
    ).toBe(false);
  });
});
