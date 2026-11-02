import { z } from 'zod';
import { USER_LIMITS } from '../constants.js';
import { USER_STATUSES } from '../domain.js';
import { existingPasswordSchema } from './auth.js';

/** GET /admin/users (FR-AD5). Search is by email only. */
export const adminUsersQuerySchema = z.strictObject({
  q: z.string().trim().toLowerCase().max(USER_LIMITS.emailMax).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
});

/** PATCH /admin/users/:id/status. FR-AD10: the admin re-enters their password. */
export const adminUserStatusSchema = z.strictObject({
  status: z.enum(USER_STATUSES),
  password: existingPasswordSchema,
});

/**
 * FR-AD7, NFR-PR3, AC-12: admin DTOs are strict objects with no resource fields, so a
 * contract test can parse every admin response with these and fail on any extra key.
 */
export const adminUserSummarySchema = z.strictObject({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  createdAt: z.iso.datetime(),
  emailVerified: z.boolean(),
  lastLoginAt: z.iso.datetime().nullable(),
  lastActiveAt: z.iso.datetime().nullable(),
  resourceCount: z.number().int().nonnegative(),
  status: z.enum(USER_STATUSES),
});

export const adminUserListSchema = z.strictObject({
  items: z.array(adminUserSummarySchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().nonnegative(),
});

/** PATCH /admin/users/:id/status response. */
export const adminUserStatusResponseSchema = z.strictObject({ user: adminUserSummarySchema });

const count = z.number().int().nonnegative();

const trendPointSchema = z.strictObject({
  date: z.iso.date(),
  newUsers: count,
  resourcesAdded: count,
});

/** GET /admin/stats (FR-AD3, FR-AD4). Counts only. */
export const adminStatsSchema = z.strictObject({
  generatedAt: z.iso.datetime(),
  users: z.strictObject({
    total: count,
    verified: count,
    unverified: count,
    newToday: count,
    new7d: count,
    new30d: count,
    active7d: count,
    active30d: count,
    withZeroResources: count,
  }),
  resources: z.strictObject({
    total: count,
    addedToday: count,
    added7d: count,
    added30d: count,
    averagePerUser: z.number().nonnegative(),
    pinned: count,
  }),
  trend: z.array(trendPointSchema).length(30),
});

export type AdminUsersQuery = z.output<typeof adminUsersQuerySchema>;
export type AdminUserStatusBody = z.output<typeof adminUserStatusSchema>;
export type AdminUserSummary = z.output<typeof adminUserSummarySchema>;
export type AdminUserList = z.output<typeof adminUserListSchema>;
export type AdminStats = z.output<typeof adminStatsSchema>;
