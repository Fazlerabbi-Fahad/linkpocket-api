import {
  PAGINATION,
  isObjectIdHex,
  type AdminStats,
  type AdminUserList,
  type AdminUserStatusBody,
  type AdminUserSummary,
  type AdminUsersQuery,
} from '../shared/index.js';
import mongoose, { type Types } from 'mongoose';
import type { AuthService } from '../auth/auth-service.js';
import type { SessionUser } from '../auth/session-service.js';
import { AuditLogModel, AuthSessionModel, ResourceModel, UserModel } from '../db/models/index.js';
import { AppError } from '../lib/app-error.js';
import type { Clock } from '../lib/clock.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const TREND_DAYS = 30;

/** Midnight UTC of the given instant. "Today" and the trend's days are UTC days (OQ-40). */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const iso = (date: Date | null | undefined): string | null => (date ? date.toISOString() : null);

/** Only these user fields are read for admin views; resource documents are only counted. */
const SUMMARY_FIELDS = {
  email: 1,
  name: 1,
  createdAt: 1,
  emailVerifiedAt: 1,
  lastLoginAt: 1,
  lastActiveAt: 1,
  status: 1,
} as const;

type SummaryUser = Pick<
  SessionUser,
  | '_id'
  | 'email'
  | 'name'
  | 'createdAt'
  | 'emailVerifiedAt'
  | 'lastLoginAt'
  | 'lastActiveAt'
  | 'status'
>;

/**
 * FR-AD7, AC-12: every admin response is built field by field from user metadata and counts.
 * No method here selects a resource's url, title, note or tags.
 */
function toSummary(user: SummaryUser, resourceCount: number): AdminUserSummary {
  return {
    id: user._id.toHexString(),
    email: user.email,
    name: user.name ?? null,
    createdAt: user.createdAt.toISOString(),
    emailVerified: user.emailVerifiedAt !== null,
    lastLoginAt: iso(user.lastLoginAt),
    lastActiveAt: iso(user.lastActiveAt),
    resourceCount,
    status: user.status,
  };
}

/** Admin area (FR-AD3 to FR-AD10). Callers have passed requireAdmin. */
export class AdminService {
  constructor(
    private readonly clock: Clock,
    private readonly auth: AuthService,
  ) {}

  /** FR-AD3, FR-AD4, FR-AD9: counts only, computed on every request. */
  async stats(): Promise<AdminStats> {
    const now = this.clock.now();
    const today = startOfUtcDay(now);
    const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const trendStart = new Date(today.getTime() - (TREND_DAYS - 1) * DAY_MS);

    const [
      total,
      verified,
      newToday,
      new7d,
      new30d,
      active7d,
      active30d,
      resourcesTotal,
      addedToday,
      added7d,
      added30d,
      pinned,
      owners,
      userDays,
      resourceDays,
    ] = await Promise.all([
      UserModel.countDocuments(),
      UserModel.countDocuments({ emailVerifiedAt: { $ne: null } }),
      UserModel.countDocuments({ createdAt: { $gte: today } }),
      UserModel.countDocuments({ createdAt: { $gte: ago(7) } }),
      UserModel.countDocuments({ createdAt: { $gte: ago(30) } }),
      UserModel.countDocuments({ lastActiveAt: { $gte: ago(7) } }),
      UserModel.countDocuments({ lastActiveAt: { $gte: ago(30) } }),
      ResourceModel.countDocuments(),
      ResourceModel.countDocuments({ createdAt: { $gte: today } }),
      ResourceModel.countDocuments({ createdAt: { $gte: ago(7) } }),
      ResourceModel.countDocuments({ createdAt: { $gte: ago(30) } }),
      ResourceModel.countDocuments({ isPinned: true }),
      ResourceModel.aggregate<{ n: number }>([{ $group: { _id: '$userId' } }, { $count: 'n' }]),
      this.perDay(UserModel, trendStart),
      this.perDay(ResourceModel, trendStart),
    ]);

    const trend = Array.from({ length: TREND_DAYS }, (_, index) => {
      const date = new Date(trendStart.getTime() + index * DAY_MS).toISOString().slice(0, 10);
      return {
        date,
        newUsers: userDays.get(date) ?? 0,
        resourcesAdded: resourceDays.get(date) ?? 0,
      };
    });

    return {
      generatedAt: now.toISOString(),
      users: {
        total,
        verified,
        unverified: total - verified,
        newToday,
        new7d,
        new30d,
        active7d,
        active30d,
        withZeroResources: Math.max(0, total - (owners[0]?.n ?? 0)),
      },
      resources: {
        total: resourcesTotal,
        addedToday,
        added7d,
        added30d,
        averagePerUser: total === 0 ? 0 : Math.round((resourcesTotal / total) * 100) / 100,
        pinned,
      },
      trend,
    };
  }

  private async perDay(
    collection: typeof UserModel | typeof ResourceModel,
    since: Date,
  ): Promise<Map<string, number>> {
    const rows = await (collection as typeof UserModel).aggregate<{ _id: string; n: number }>([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
          n: { $sum: 1 },
        },
      },
    ]);
    return new Map(rows.map((row) => [row._id, row.n]));
  }

  /** FR-AD5: newest first, 25 per page, searchable by email (substring). */
  async users(query: AdminUsersQuery): Promise<AdminUserList> {
    const filter = query.q ? { email: { $regex: escapeRegex(query.q) } } : {};
    const pageSize = PAGINATION.adminUsersPageSize;
    const [total, users] = await Promise.all([
      UserModel.countDocuments(filter),
      UserModel.find(filter, SUMMARY_FIELDS)
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * pageSize)
        .limit(pageSize)
        .lean<SummaryUser[]>(),
    ]);
    const counts = await this.resourceCounts(users.map((user) => user._id));
    return {
      items: users.map((user) => toSummary(user, counts.get(user._id.toHexString()) ?? 0)),
      page: query.page,
      pageSize,
      total,
    };
  }

  private async resourceCounts(ids: Types.ObjectId[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await ResourceModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { userId: { $in: ids } } },
      { $group: { _id: '$userId', n: { $sum: 1 } } },
    ]);
    return new Map(rows.map((row) => [row._id.toHexString(), row.n]));
  }

  /**
   * FR-AD6, FR-AD8, FR-AD10. The admin re-enters their password (under the FR-A9 lockout).
   * Disabling keeps all data, ends every session at once (sessionVersion and session
   * records), and is audited in the same transaction. Admin accounts, including the caller's
   * own, cannot be changed here (OQ-39). Setting the current status again changes nothing.
   */
  async setStatus(
    admin: SessionUser,
    targetId: string,
    body: AdminUserStatusBody,
  ): Promise<AdminUserSummary> {
    try {
      await this.auth.confirmPassword(admin.email, body.password);
    } catch (error) {
      if (error instanceof AppError && error.code === 'INVALID_CREDENTIALS') {
        throw new AppError('REAUTH_REQUIRED');
      }
      throw error;
    }

    if (!isObjectIdHex(targetId)) throw new AppError('NOT_FOUND');
    const target = await UserModel.findById(targetId, { ...SUMMARY_FIELDS, role: 1 }).lean<
      SummaryUser & { role: string }
    >();
    if (!target) throw new AppError('NOT_FOUND');
    if (target.role === 'admin') throw new AppError('FORBIDDEN');

    if (target.status !== body.status) {
      const disabling = body.status === 'disabled';
      await mongoose.connection.transaction(async (session) => {
        await UserModel.updateOne(
          { _id: target._id },
          disabling
            ? { $set: { status: 'disabled' }, $inc: { sessionVersion: 1 } }
            : { $set: { status: 'active' } },
          { session },
        );
        if (disabling) await AuthSessionModel.deleteMany({ userId: target._id }, { session });
        await AuditLogModel.create(
          [
            {
              actorId: admin._id.toHexString(),
              targetUserId: target._id,
              action: disabling ? 'user.disable' : 'user.enable',
              createdAt: this.clock.now(),
            },
          ],
          { session },
        );
      });
    }

    const counts = await this.resourceCounts([target._id]);
    return toSummary({ ...target, status: body.status }, counts.get(target._id.toHexString()) ?? 0);
  }
}
