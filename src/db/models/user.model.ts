import {
  USER_LIMITS,
  USER_ROLES,
  USER_STATUSES,
  type UserRole,
  type UserStatus,
} from '../../shared/index.js';
import mongoose, { Schema, model, type HydratedDocument, type Model } from 'mongoose';
import { VERIFICATION_TOKEN_INDEX } from '../migrations/0006-index-verification-token.js';

/** SRS Section 5.1. */
export interface User {
  email: string;
  passwordHash: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
  sessionVersion: number;
  emailVerifiedAt: Date | null;
  emailVerificationTokenHash: string | null;
  emailVerificationExpiresAt: Date | null;
  verificationEmailSentAt: Date[];
  privacyPolicyAcceptedAt: Date;
  createdAt: Date;
  lastLoginAt: Date | null;
  lastActiveAt: Date | null;
}

export type UserDocument = HydratedDocument<User>;

// The API validates addresses fully with the shared Zod schema; this is a backstop.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

/** Fields that must never leave the API (FR-D1, Section 5.1 passwordHash). */
export const USER_SECRET_FIELDS = [
  'passwordHash',
  'emailVerificationTokenHash',
  'emailVerificationExpiresAt',
  'verificationEmailSentAt',
] as const;

const userSchema = new Schema<User>(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: USER_LIMITS.emailMax,
      match: EMAIL_SHAPE,
    },
    // select: false keeps hashes out of every query unless a service asks for them.
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, trim: true, maxlength: USER_LIMITS.nameMax, default: null },
    role: { type: String, enum: USER_ROLES, required: true, default: 'user' },
    status: { type: String, enum: USER_STATUSES, required: true, default: 'active' },
    sessionVersion: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: { validator: Number.isInteger, message: 'sessionVersion must be an integer' },
    },
    emailVerifiedAt: { type: Date, default: null },
    // NFR-S9: only the SHA-256 hash of the verification token is stored.
    emailVerificationTokenHash: { type: String, default: null, match: SHA256_HEX, select: false },
    emailVerificationExpiresAt: { type: Date, default: null },
    verificationEmailSentAt: { type: [Date], default: [] },
    privacyPolicyAcceptedAt: { type: Date, required: true }, // NFR-PR4
    createdAt: { type: Date, required: true, immutable: true, default: () => new Date() },
    lastLoginAt: { type: Date, default: null },
    lastActiveAt: { type: Date, default: null },
  },
  {
    collection: 'users',
    strict: 'throw',
    versionKey: false,
    toJSON: { transform: stripSecrets },
    toObject: { transform: stripSecrets },
  },
);

function stripSecrets(_doc: unknown, ret: Record<string, unknown>): Record<string, unknown> {
  for (const field of USER_SECRET_FIELDS) delete ret[field];
  return ret;
}

// Index names must match migrations/0001-create-users.ts (see the drift test).
userSchema.index({ email: 1 }, { name: 'email_unique', unique: true });
userSchema.index({ createdAt: -1 }, { name: 'createdAt_desc' });
userSchema.index({ lastActiveAt: -1 }, { name: 'lastActiveAt_desc' });
userSchema.index({ emailVerifiedAt: 1, createdAt: 1 }, { name: 'emailVerifiedAt_createdAt' });
// migrations/0006: verify-email looks the account up by token hash (FR-A5, NFR-S9).
userSchema.index(
  { emailVerificationTokenHash: 1 },
  {
    name: VERIFICATION_TOKEN_INDEX.name,
    unique: true,
    partialFilterExpression: VERIFICATION_TOKEN_INDEX.partialFilterExpression,
  },
);

export const UserModel: Model<User> =
  (mongoose.models.User as Model<User> | undefined) ?? model<User>('User', userSchema);
