import {
  adminStatsSchema,
  adminUserListSchema,
  adminUserStatusResponseSchema,
  type AdminUserList,
} from '../../src/shared/index.js';
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  AuditLogModel,
  AuthSessionModel,
  ResourceModel,
  UserModel,
} from '../../src/db/models/index.js';
import { useMigratedDb } from '../migrated-db.js';
import {
  OTHER_STRONG_PASSWORD,
  STRONG_PASSWORD,
  TestClient,
  createHarness,
  loggedInClient,
  uniqueEmail,
  type ApiResponse,
} from '../harness.js';

const status = (id: string) => `/api/v1/admin/users/${id}/status`;

async function idOf(email: string): Promise<string> {
  const user = await UserModel.findOne({ email }).lean();
  if (!user) throw new Error('missing user');
  return user._id.toHexString();
}

describe('admin users and status changes', () => {
  useMigratedDb();
  const { app, clock } = createHarness();

  async function setup() {
    const adminEmail = uniqueEmail('admin');
    const admin = await loggedInClient(app, adminEmail, STRONG_PASSWORD, 'admin');
    const targetEmail = uniqueEmail('target');
    const target = await loggedInClient(app, targetEmail);
    await target.send('post', '/api/v1/resources', { url: 'https://a.example.com/' });
    await target.send('post', '/api/v1/resources', { url: 'https://b.example.com/' });
    return {
      admin,
      adminId: await idOf(adminEmail),
      target,
      targetEmail,
      targetId: await idOf(targetEmail),
    };
  }

  const audits = (targetId: string) =>
    AuditLogModel.find({ targetUserId: targetId, action: { $in: ['user.disable', 'user.enable'] } })
      .sort({ createdAt: 1, _id: 1 })
      .lean();

  describe('FR-AD5: user list', () => {
    it('shows each account summary with its resource count', async () => {
      const { admin, targetEmail, targetId } = await setup();
      const res = await admin.send(
        'get',
        `/api/v1/admin/users?q=${encodeURIComponent(targetEmail)}`,
      );
      const list = adminUserListSchema.parse(res.body);
      expect(list.total).toBe(1);
      expect(list.items[0]).toMatchObject({
        id: targetId,
        email: targetEmail,
        emailVerified: true,
        resourceCount: 2,
        status: 'active',
      });
      expect(list.items[0]?.lastLoginAt).not.toBeNull();
    });

    it('pages 25 at a time, newest first', async () => {
      const prefix = `paging${new Types.ObjectId().toHexString()}`;
      const base = clock.now().getTime();
      await UserModel.insertMany(
        Array.from({ length: 30 }, (_, i) => ({
          email: `${prefix}.${String(i).padStart(2, '0')}@example.com`,
          passwordHash: 'not-a-real-hash',
          privacyPolicyAcceptedAt: new Date(base),
          createdAt: new Date(base - i * 60_000),
        })),
      );
      const admin = await loggedInClient(app, uniqueEmail('pager'), STRONG_PASSWORD, 'admin');
      const page = async (n: number): Promise<AdminUserList> =>
        adminUserListSchema.parse(
          (await admin.send('get', `/api/v1/admin/users?q=${prefix}&page=${n}`)).body,
        );
      const first = await page(1);
      const second = await page(2);
      expect(first).toMatchObject({ page: 1, pageSize: 25, total: 30 });
      expect(first.items).toHaveLength(25);
      expect(second.items).toHaveLength(5);
      expect(first.items[0]?.email).toBe(`${prefix}.00@example.com`);
      expect(second.items[4]?.email).toBe(`${prefix}.29@example.com`);
      expect((await page(3)).items).toEqual([]);
    });

    it('searches by email substring, case-insensitively, with regex characters taken literally', async () => {
      const { admin, targetEmail } = await setup();
      const fragment = targetEmail.split('@')[0]!.toUpperCase();
      const found = adminUserListSchema.parse(
        (await admin.send('get', `/api/v1/admin/users?q=${encodeURIComponent(fragment)}`)).body,
      );
      expect(found.items.map((u) => u.email)).toEqual([targetEmail]);
      const literal = adminUserListSchema.parse(
        (await admin.send('get', `/api/v1/admin/users?q=${encodeURIComponent('.+')}`)).body,
      );
      expect(literal.total).toBe(0);
    });

    it('rejects unknown query parameters', async () => {
      const { admin } = await setup();
      const res = await admin.send('get', '/api/v1/admin/users?role=admin');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('FR-AD6, FR-AD8, FR-AD10: disable and enable', () => {
    it('disabling keeps the data, ends sessions at once and is audited', async () => {
      const { admin, adminId, target, targetEmail, targetId } = await setup();
      const res = await admin.send('patch', status(targetId), {
        status: 'disabled',
        password: STRONG_PASSWORD,
      });
      expect(res.status).toBe(200);
      expect(adminUserStatusResponseSchema.parse(res.body).user).toMatchObject({
        id: targetId,
        status: 'disabled',
        resourceCount: 2,
      });

      const me = await target.me();
      expect(me.status).toBe(403);
      expect(me.body.error.code).toBe('ACCOUNT_DISABLED');
      expect(await AuthSessionModel.countDocuments({ userId: targetId })).toBe(0);
      expect((await new TestClient(app).init().then((c) => c.login(targetEmail))).status).toBe(403);
      expect(await ResourceModel.countDocuments({ userId: targetId })).toBe(2);

      const entries = await audits(targetId);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ actorId: adminId, action: 'user.disable' });
      expect(entries[0]?.createdAt.getTime()).toBe(clock.now().getTime());
    });

    it('enabling restores access and is audited', async () => {
      const { admin, adminId, targetEmail, targetId } = await setup();
      await admin.send('patch', status(targetId), {
        status: 'disabled',
        password: STRONG_PASSWORD,
      });
      const res = await admin.send('patch', status(targetId), {
        status: 'active',
        password: STRONG_PASSWORD,
      });
      expect(res.status).toBe(200);
      expect(adminUserStatusResponseSchema.parse(res.body).user.status).toBe('active');

      const again = await new TestClient(app).init();
      expect((await again.login(targetEmail)).status).toBe(200);
      const list = (await again.send('get', '/api/v1/resources')).body as unknown as {
        items: unknown[];
      };
      expect(list.items).toHaveLength(2);
      expect((await audits(targetId)).map((e) => [e.actorId, e.action])).toEqual([
        [adminId, 'user.disable'],
        [adminId, 'user.enable'],
      ]);
    });

    it('setting the current status again changes nothing and writes no audit entry', async () => {
      const { admin, targetId } = await setup();
      const res = await admin.send('patch', status(targetId), {
        status: 'active',
        password: STRONG_PASSWORD,
      });
      expect(res.status).toBe(200);
      expect(await audits(targetId)).toHaveLength(0);
    });

    it('a wrong password is REAUTH_REQUIRED and nothing changes', async () => {
      const { admin, target, targetId } = await setup();
      const res = await admin.send('patch', status(targetId), {
        status: 'disabled',
        password: OTHER_STRONG_PASSWORD,
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('REAUTH_REQUIRED');
      expect((await target.me()).status).toBe(200);
      expect(await audits(targetId)).toHaveLength(0);
      // The admin's own session is unaffected.
      expect((await admin.send('get', '/api/v1/admin/stats')).status).toBe(200);
    });

    it('repeated wrong passwords hit the login lockout (FR-A9)', async () => {
      const { admin, targetId } = await setup();
      let last: ApiResponse | undefined;
      for (let i = 0; i < 5; i += 1) {
        last = await admin.send('patch', status(targetId), {
          status: 'disabled',
          password: OTHER_STRONG_PASSWORD,
        });
      }
      expect(last?.body.error.code).toBe('ACCOUNT_LOCKED');
      const correct = await admin.send('patch', status(targetId), {
        status: 'disabled',
        password: STRONG_PASSWORD,
      });
      expect(correct.body.error.code).toBe('ACCOUNT_LOCKED');
    });

    it.each([
      [{ status: 'disabled' }, 'missing password'],
      [{ status: 'banned', password: STRONG_PASSWORD }, 'unknown status'],
      [{ status: 'disabled', password: STRONG_PASSWORD, role: 'admin' }, 'extra key'],
    ])('rejects %j (%s)', async (body, _reason) => {
      const { admin, targetId } = await setup();
      const res = await admin.send('patch', status(targetId), body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses to change an admin account, including the caller', async () => {
      const { admin, adminId } = await setup();
      const otherEmail = uniqueEmail('other-admin');
      await loggedInClient(app, otherEmail, STRONG_PASSWORD, 'admin');
      for (const id of [adminId, await idOf(otherEmail)]) {
        const res = await admin.send('patch', status(id), {
          status: 'disabled',
          password: STRONG_PASSWORD,
        });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        expect((await UserModel.findById(id).lean())?.status).toBe('active');
      }
    });

    it.each(['0123456789abcdef01234567', 'not-an-id'])('answers 404 for %s', async (id) => {
      const { admin } = await setup();
      const res = await admin.send('patch', status(id), {
        status: 'disabled',
        password: STRONG_PASSWORD,
      });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('requires the CSRF header (NFR-S10)', async () => {
      const { admin, targetId } = await setup();
      const res = await admin.send(
        'patch',
        status(targetId),
        { status: 'disabled', password: STRONG_PASSWORD },
        { csrf: false },
      );
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_INVALID');
      expect((await UserModel.findById(targetId).lean())?.status).toBe('active');
    });
  });

  describe('AC-12, FR-AD7: admin responses never contain resource content', () => {
    const MARK = 'zqleakmark';

    it('stats, user lists, status changes and errors carry no URL, title, note or tag', async () => {
      const admin = await loggedInClient(app, uniqueEmail('contract'), STRONG_PASSWORD, 'admin');
      const ownerEmail = uniqueEmail('owner');
      const owner = await loggedInClient(app, ownerEmail);
      const created = await owner.send('post', '/api/v1/resources', {
        url: `https://${MARK}-host.example.com/${MARK}-path?${MARK}=1`,
        title: `${MARK} title`,
        note: `${MARK} note`,
        tags: [`${MARK}-tag`],
      });
      expect(created.status).toBe(201);
      const ownerId = await idOf(ownerEmail);
      const reauth = { password: STRONG_PASSWORD };

      const responses: [string, ApiResponse, (body: unknown) => unknown][] = [
        ['stats', await admin.send('get', '/api/v1/admin/stats'), (b) => adminStatsSchema.parse(b)],
        [
          'users',
          await admin.send('get', '/api/v1/admin/users'),
          (b) => adminUserListSchema.parse(b),
        ],
        [
          'users?q',
          await admin.send('get', `/api/v1/admin/users?q=${encodeURIComponent(ownerEmail)}`),
          (b) => adminUserListSchema.parse(b),
        ],
        [
          'disable',
          await admin.send('patch', status(ownerId), { status: 'disabled', ...reauth }),
          (b) => adminUserStatusResponseSchema.parse(b),
        ],
        [
          'enable',
          await admin.send('patch', status(ownerId), { status: 'active', ...reauth }),
          (b) => adminUserStatusResponseSchema.parse(b),
        ],
        [
          'search for the marker',
          await admin.send('get', `/api/v1/admin/users?q=${MARK}`),
          (b) => adminUserListSchema.parse(b),
        ],
        [
          'error',
          await admin.send('patch', status('0123456789abcdef01234567'), {
            status: 'disabled',
            ...reauth,
          }),
          (b) => b,
        ],
      ];

      for (const [name, res, parse] of responses) {
        // Strict schemas fail on any key they do not list (FR-AD7).
        expect(() => parse(res.body), name).not.toThrow();
        expect(JSON.stringify(res.body).toLowerCase(), name).not.toContain(MARK);
        expect(JSON.stringify(res.headers).toLowerCase(), name).not.toContain(MARK);
      }
      const owners = adminUserListSchema.parse(responses[2]![1].body);
      expect(owners.items[0]?.resourceCount).toBe(1);
    });
  });
});
