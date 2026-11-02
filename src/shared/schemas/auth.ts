import { z } from 'zod';
import { USER_LIMITS } from '../constants.js';
import { USER_ROLES } from '../domain.js';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(USER_LIMITS.emailMax)
  .pipe(z.email('Enter a valid email address.'));

/** FR-A10 length rule. Common and breached password screening runs on the server. */
export const newPasswordSchema = z
  .string()
  .min(USER_LIMITS.passwordMin, `Use at least ${USER_LIMITS.passwordMin} characters.`)
  .max(USER_LIMITS.passwordMax, `Use at most ${USER_LIMITS.passwordMax} characters.`);

/** For login and re-authentication: never reveal the policy, only bound the length. */
export const existingPasswordSchema = z.string().min(1).max(USER_LIMITS.passwordMax);

export const nameSchema = z
  .string()
  .trim()
  .max(USER_LIMITS.nameMax)
  .transform((value) => (value === '' ? undefined : value));

export const signupSchema = z.strictObject({
  email: emailSchema,
  password: newPasswordSchema,
  name: nameSchema.optional(),
  // NFR-PR4: the client must show the privacy notice and send explicit consent.
  acceptPrivacyPolicy: z.literal(true, 'You must accept the privacy policy.'),
});

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: existingPasswordSchema,
});

/** NFR-S9: 32 random bytes, base64url encoded (43 characters). */
export const verificationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid token');

export const verifyEmailSchema = z.strictObject({
  token: verificationTokenSchema,
});

export const resendVerificationSchema = z.strictObject({
  email: emailSchema,
});

export const changePasswordSchema = z
  .strictObject({
    currentPassword: existingPasswordSchema,
    newPassword: newPasswordSchema,
  })
  .refine((body) => body.currentPassword !== body.newPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from the current one.',
  });

/** FR-D2: deletion requires re-entering the password. */
export const deleteAccountSchema = z.strictObject({
  password: existingPasswordSchema,
});

/** GET /auth/me */
export const currentUserSchema = z.strictObject({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  role: z.enum(USER_ROLES),
  emailVerified: z.boolean(),
});

export type SignupInput = z.input<typeof signupSchema>;
export type SignupBody = z.output<typeof signupSchema>;
export type LoginBody = z.output<typeof loginSchema>;
export type VerifyEmailBody = z.output<typeof verifyEmailSchema>;
export type ResendVerificationBody = z.output<typeof resendVerificationSchema>;
export type ChangePasswordBody = z.output<typeof changePasswordSchema>;
export type DeleteAccountBody = z.output<typeof deleteAccountSchema>;
export type CurrentUser = z.output<typeof currentUserSchema>;
