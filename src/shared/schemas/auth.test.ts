import { describe, expect, it } from 'vitest';
import { USER_LIMITS } from '../constants.js';
import {
  changePasswordSchema,
  deleteAccountSchema,
  emailSchema,
  loginSchema,
  newPasswordSchema,
  resendVerificationSchema,
  signupSchema,
  verifyEmailSchema,
} from './auth.js';

const validSignup = {
  email: 'Person@Example.com ',
  password: 'correct horse battery',
  acceptPrivacyPolicy: true,
};

describe('emailSchema (Section 5.1)', () => {
  it('trims and lowercases', () => {
    expect(emailSchema.parse('  Person@Example.COM ')).toBe('person@example.com');
  });

  it('rejects invalid and over-long addresses', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    const long = `${'a'.repeat(USER_LIMITS.emailMax)}@example.com`;
    expect(emailSchema.safeParse(long).success).toBe(false);
  });
});

describe('newPasswordSchema (FR-A10 length rule)', () => {
  it('accepts 8 to 128 characters', () => {
    expect(newPasswordSchema.safeParse('a'.repeat(7)).success).toBe(false);
    expect(newPasswordSchema.safeParse('a'.repeat(8)).success).toBe(true);
    expect(newPasswordSchema.safeParse('a'.repeat(128)).success).toBe(true);
    expect(newPasswordSchema.safeParse('a'.repeat(129)).success).toBe(false);
  });
});

describe('signupSchema (FR-A1, NFR-PR4)', () => {
  it('parses a valid signup and normalizes the email', () => {
    expect(signupSchema.parse(validSignup)).toEqual({
      email: 'person@example.com',
      password: 'correct horse battery',
      acceptPrivacyPolicy: true,
    });
  });

  it('requires explicit privacy policy consent', () => {
    expect(signupSchema.safeParse({ ...validSignup, acceptPrivacyPolicy: false }).success).toBe(
      false,
    );
    const { acceptPrivacyPolicy: _omit, ...withoutConsent } = validSignup;
    expect(signupSchema.safeParse(withoutConsent).success).toBe(false);
  });

  it('treats a blank name as absent and limits names to 100 characters', () => {
    expect(signupSchema.parse({ ...validSignup, name: '   ' }).name).toBeUndefined();
    expect(signupSchema.parse({ ...validSignup, name: ' Sam ' }).name).toBe('Sam');
    expect(signupSchema.safeParse({ ...validSignup, name: 'x'.repeat(101) }).success).toBe(false);
  });

  it('rejects extra keys, so a client cannot send role or emailVerifiedAt', () => {
    expect(signupSchema.safeParse({ ...validSignup, role: 'admin' }).success).toBe(false);
  });
});

describe('other auth bodies', () => {
  it('login bounds the password length without applying the signup policy', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x'.repeat(129) }).success).toBe(
      false,
    );
  });

  it('verification tokens must be 43 base64url characters (NFR-S9)', () => {
    expect(verifyEmailSchema.safeParse({ token: 'A'.repeat(43) }).success).toBe(true);
    expect(verifyEmailSchema.safeParse({ token: 'A'.repeat(42) }).success).toBe(false);
    expect(verifyEmailSchema.safeParse({ token: `${'A'.repeat(42)}=` }).success).toBe(false);
  });

  it('resend takes an email only', () => {
    expect(resendVerificationSchema.parse({ email: 'A@B.co' })).toEqual({ email: 'a@b.co' });
  });

  it('change password requires a different, policy-compliant new password', () => {
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'new-password-1' })
        .success,
    ).toBe(true);
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'same-pass', newPassword: 'same-pass' })
        .success,
    ).toBe(false);
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'short' }).success,
    ).toBe(false);
  });

  it('account deletion requires the password (FR-D2)', () => {
    expect(deleteAccountSchema.safeParse({}).success).toBe(false);
    expect(deleteAccountSchema.safeParse({ password: 'x' }).success).toBe(true);
  });
});
