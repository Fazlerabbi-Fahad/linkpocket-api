import { describe, expect, it } from 'vitest';
import { useMigratedDb } from '../../../test/migrated-db.js';
import { validationErrors } from '../../../test/validation.js';
import { UserModel } from './user.model.js';

const base = () => ({
  email: 'Person@Example.com',
  passwordHash: '$2b$12$abcdefghijklmnopqrstuuvwxyzABCDEFGHIJKLMNOPQRSTUVW',
  privacyPolicyAcceptedAt: new Date(),
});

describe('UserModel validation (SRS 5.1)', () => {
  it('applies defaults and normalizes the email', async () => {
    const user = new UserModel({ ...base(), email: '  Person@Example.COM ' });
    expect(await validationErrors(user)).toBeUndefined();
    expect(user.email).toBe('person@example.com');
    expect(user.role).toBe('user');
    expect(user.status).toBe('active');
    expect(user.sessionVersion).toBe(0);
    expect(user.name).toBeNull();
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.lastLoginAt).toBeNull();
    expect(user.lastActiveAt).toBeNull();
    expect([...user.verificationEmailSentAt]).toEqual([]);
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  it.each([
    ['email', undefined],
    ['email', 'not-an-email'],
    ['email', `${'a'.repeat(250)}@example.com`],
    ['passwordHash', undefined],
    ['privacyPolicyAcceptedAt', undefined],
    ['role', 'superuser'],
    ['status', 'deleted'],
    ['sessionVersion', -1],
    ['sessionVersion', 1.5],
    ['name', 'x'.repeat(101)],
    ['emailVerificationTokenHash', 'not-a-sha256'],
  ])('rejects %s = %j', async (field, value) => {
    const user = new UserModel({ ...base(), [field]: value });
    expect((await validationErrors(user))?.[field]).toBeDefined();
  });

  it('rejects fields that are not in the data model (NFR-PR1)', () => {
    expect(() => new UserModel({ ...base(), phone: '555' })).toThrow();
  });

  it('never serializes secrets (FR-D1, Section 5.1 passwordHash)', () => {
    const user = new UserModel({
      ...base(),
      emailVerificationTokenHash: 'a'.repeat(64),
      emailVerificationExpiresAt: new Date(),
      verificationEmailSentAt: [new Date()],
    });
    const serialized: unknown[] = [
      user.toJSON(),
      user.toObject(),
      JSON.parse(JSON.stringify(user)),
    ];
    for (const json of serialized) {
      expect(json).not.toHaveProperty('passwordHash');
      expect(json).not.toHaveProperty('emailVerificationTokenHash');
      expect(json).not.toHaveProperty('emailVerificationExpiresAt');
      expect(json).not.toHaveProperty('verificationEmailSentAt');
      expect(json).toHaveProperty('email', 'person@example.com');
    }
  });
});

describe('UserModel with the database', () => {
  useMigratedDb();

  it('enforces unique email regardless of input case', async () => {
    await UserModel.create(base());
    await expect(
      UserModel.create({ ...base(), email: 'PERSON@example.com' }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('does not load password or token hashes unless selected', async () => {
    const created = await UserModel.create({
      ...base(),
      email: 'hash@example.com',
      emailVerificationTokenHash: 'b'.repeat(64),
    });
    const plain = await UserModel.findById(created._id).lean();
    expect(plain).not.toHaveProperty('passwordHash');
    expect(plain).not.toHaveProperty('emailVerificationTokenHash');

    const withSecrets = await UserModel.findById(created._id)
      .select('+passwordHash +emailVerificationTokenHash')
      .lean();
    expect(withSecrets?.passwordHash).toBe(base().passwordHash);
    expect(withSecrets?.emailVerificationTokenHash).toBe('b'.repeat(64));
  });

  it('keeps createdAt immutable on update', async () => {
    const created = await UserModel.create({ ...base(), email: 'immutable@example.com' });
    await UserModel.updateOne({ _id: created._id }, { $set: { createdAt: new Date(0) } });
    const reloaded = await UserModel.findById(created._id).lean();
    expect(reloaded?.createdAt).toEqual(created.createdAt);
  });
});
