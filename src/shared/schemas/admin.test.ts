import { describe, expect, it } from 'vitest';
import {
  adminStatsSchema,
  adminUserStatusSchema,
  adminUserSummarySchema,
  adminUsersQuerySchema,
} from './admin.js';

const summary = {
  id: '65f0c0ffee0000000000abcd',
  email: 'a@b.co',
  name: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  emailVerified: true,
  lastLoginAt: null,
  lastActiveAt: null,
  resourceCount: 3,
  status: 'active',
};

describe('admin contracts (FR-AD5, FR-AD7, AC-12)', () => {
  it('accepts an account summary', () => {
    expect(adminUserSummarySchema.parse(summary)).toEqual(summary);
  });

  it.each(['url', 'title', 'note', 'tags', 'resources'])(
    'rejects a summary that leaks resource content (%s)',
    (key) => {
      expect(adminUserSummarySchema.safeParse({ ...summary, [key]: 'x' }).success).toBe(false);
    },
  );

  it('stats require exactly 30 trend points and counts only', () => {
    const trend = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-10-${String(i + 1).padStart(2, '0')}`,
      newUsers: 1,
      resourcesAdded: 2,
    }));
    const stats = {
      generatedAt: '2026-10-31T00:00:00.000Z',
      users: {
        total: 1,
        verified: 1,
        unverified: 0,
        newToday: 0,
        new7d: 0,
        new30d: 1,
        active7d: 1,
        active30d: 1,
        withZeroResources: 0,
      },
      resources: {
        total: 2,
        addedToday: 0,
        added7d: 0,
        added30d: 2,
        averagePerUser: 2,
        pinned: 0,
      },
      trend,
    };
    expect(adminStatsSchema.safeParse(stats).success).toBe(true);
    expect(adminStatsSchema.safeParse({ ...stats, trend: trend.slice(1) }).success).toBe(false);
    expect(
      adminStatsSchema.safeParse({ ...stats, resources: { ...stats.resources, topUrls: [] } })
        .success,
    ).toBe(false);
  });
});

describe('admin inputs', () => {
  it('user list query defaults to page 1 and lowercases the email search', () => {
    expect(adminUsersQuerySchema.parse({})).toEqual({ page: 1 });
    expect(adminUsersQuerySchema.parse({ q: ' Foo@X ', page: '3' })).toEqual({
      q: 'foo@x',
      page: 3,
    });
    expect(adminUsersQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('status change requires a password for re-authentication (FR-AD10)', () => {
    expect(adminUserStatusSchema.safeParse({ status: 'disabled' }).success).toBe(false);
    expect(adminUserStatusSchema.safeParse({ status: 'deleted', password: 'x' }).success).toBe(
      false,
    );
    expect(adminUserStatusSchema.parse({ status: 'disabled', password: 'x' })).toEqual({
      status: 'disabled',
      password: 'x',
    });
  });
});
