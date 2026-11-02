import { AUDIT_ACTIONS, SYSTEM_ACTOR } from '../../shared/index.js';
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { useMigratedDb } from '../../../test/migrated-db.js';
import { validationErrors } from '../../../test/validation.js';
import { AuditLogModel } from './audit-log.model.js';

describe('AuditLogModel validation (SRS 5.3, clarification 3)', () => {
  it.each(AUDIT_ACTIONS)('accepts action %s', async (action) => {
    const entry = new AuditLogModel({ actorId: SYSTEM_ACTOR, action });
    expect(await validationErrors(entry)).toBeUndefined();
    expect(entry.targetUserId).toBeNull();
    expect(entry.createdAt).toBeInstanceOf(Date);
  });

  it('accepts an ObjectId hex string or "system" as actorId', async () => {
    const id = new Types.ObjectId().toHexString();
    expect(
      await validationErrors(new AuditLogModel({ actorId: id, action: 'user.disable' })),
    ).toBeUndefined();
    const byEmail = new AuditLogModel({ actorId: 'admin@example.com', action: 'user.disable' });
    expect((await validationErrors(byEmail))?.actorId).toBeDefined();
  });

  it('rejects unknown actions and missing fields', async () => {
    expect(
      (await validationErrors(new AuditLogModel({ actorId: SYSTEM_ACTOR, action: 'user.rename' })))
        ?.action,
    ).toBeDefined();
    expect(
      (await validationErrors(new AuditLogModel({ action: 'user.delete' })))?.actorId,
    ).toBeDefined();
  });

  it('cannot hold personal data beyond IDs (FR-D3)', () => {
    expect(
      () => new AuditLogModel({ actorId: SYSTEM_ACTOR, action: 'user.delete', email: 'a@b.co' }),
    ).toThrow();
  });
});

describe('AuditLogModel with the database', () => {
  useMigratedDb();

  it('writes an account deletion entry with the user ID and timestamp only (FR-D3)', async () => {
    const userId = new Types.ObjectId();
    await AuditLogModel.create({
      actorId: userId.toHexString(),
      targetUserId: userId,
      action: 'user.delete',
    });
    const stored = await AuditLogModel.findOne({ targetUserId: userId }).lean();
    expect(Object.keys(stored ?? {}).sort()).toEqual(
      ['_id', 'action', 'actorId', 'createdAt', 'targetUserId'].sort(),
    );
  });

  it('is append-only', async () => {
    const entry = await AuditLogModel.create({ actorId: SYSTEM_ACTOR, action: 'user.export' });
    await expect(
      AuditLogModel.updateOne({ _id: entry._id }, { $set: { action: 'user.enable' } }),
    ).rejects.toThrow(/append-only/);
    await expect(
      AuditLogModel.findOneAndUpdate({ _id: entry._id }, { $set: { action: 'user.enable' } }),
    ).rejects.toThrow(/append-only/);
    await expect(AuditLogModel.replaceOne({ _id: entry._id }, {})).rejects.toThrow(/append-only/);
    await expect(entry.save()).rejects.toThrow(/append-only/);
  });
});
