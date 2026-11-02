import { SESSION_LIMITS, TIMINGS } from '../../shared/index.js';
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { useMigratedDb } from '../../../test/migrated-db.js';
import { validationErrors } from '../../../test/validation.js';
import { AuthSessionModel, computeSessionExpiry, isSessionUsable } from './session.model.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const jti = () => new Types.ObjectId().toHexString();

const base = () => ({
  userId: new Types.ObjectId(),
  jti: jti(),
  expiresAt: new Date(Date.now() + DAY),
});

describe('computeSessionExpiry (FR-A8, clarification 5)', () => {
  const login = new Date('2026-11-01T00:00:00Z');

  it('gives regular users a 7-day idle window that slides with use', () => {
    expect(computeSessionExpiry({ createdAt: login, lastUsedAt: login, role: 'user' })).toEqual(
      new Date(login.getTime() + TIMINGS.sessionIdleTimeoutMs),
    );
    const later = new Date(login.getTime() + 30 * DAY);
    expect(computeSessionExpiry({ createdAt: login, lastUsedAt: later, role: 'user' })).toEqual(
      new Date(later.getTime() + 7 * DAY),
    );
  });

  it('caps admin sessions at 24 hours after login regardless of activity', () => {
    const activeLater = new Date(login.getTime() + 23 * HOUR);
    expect(
      computeSessionExpiry({ createdAt: login, lastUsedAt: activeLater, role: 'admin' }),
    ).toEqual(new Date(login.getTime() + 24 * HOUR));
  });
});

describe('isSessionUsable', () => {
  const now = new Date('2026-11-01T12:00:00Z');

  it('is false once revoked or expired', () => {
    expect(isSessionUsable({ revokedAt: null, expiresAt: new Date(now.getTime() + 1) }, now)).toBe(
      true,
    );
    expect(isSessionUsable({ revokedAt: now, expiresAt: new Date(now.getTime() + DAY) }, now)).toBe(
      false,
    );
    expect(isSessionUsable({ revokedAt: null, expiresAt: now }, now)).toBe(false);
  });
});

describe('AuthSessionModel validation (clarification 1)', () => {
  it('applies defaults', async () => {
    const session = new AuthSessionModel(base());
    expect(await validationErrors(session)).toBeUndefined();
    expect(session.revokedAt).toBeNull();
    expect(session.userAgent).toBeNull();
    expect(session.createdAt).toBeInstanceOf(Date);
    expect(session.lastUsedAt).toBeInstanceOf(Date);
  });

  it.each([
    ['userId', undefined],
    ['jti', undefined],
    ['jti', 'short'],
    ['jti', 'has spaces in it, not allowed'],
    ['expiresAt', undefined],
  ])('rejects %s = %j', async (field, value) => {
    const session = new AuthSessionModel({ ...base(), [field]: value });
    expect((await validationErrors(session))?.[field]).toBeDefined();
  });

  it('truncates long user agents and stores blank ones as null (OQ-4)', () => {
    const long = new AuthSessionModel({ ...base(), userAgent: 'x'.repeat(2000) });
    expect(long.userAgent).toHaveLength(SESSION_LIMITS.userAgentMax);
    expect(new AuthSessionModel({ ...base(), userAgent: '  ' }).userAgent).toBeNull();
  });
});

describe('AuthSessionModel with the database', () => {
  useMigratedDb();

  it('enforces a unique jti', async () => {
    const shared = jti();
    await AuthSessionModel.create({ ...base(), jti: shared });
    await expect(AuthSessionModel.create({ ...base(), jti: shared })).rejects.toMatchObject({
      code: 11000,
    });
  });

  it('records revocation (FR-A6 logout)', async () => {
    const session = await AuthSessionModel.create(base());
    const revokedAt = new Date();
    await AuthSessionModel.updateOne({ _id: session._id }, { $set: { revokedAt } });
    const reloaded = await AuthSessionModel.findById(session._id).lean();
    expect(reloaded && isSessionUsable(reloaded)).toBe(false);
  });
});
