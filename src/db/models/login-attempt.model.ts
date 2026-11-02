import mongoose, { Schema, model, type Model } from 'mongoose';

/**
 * FR-A9 lockout state (OQ-9). Keyed by SHA-256 of the normalized email so that attempts on
 * addresses without an account do not store those addresses in plain text.
 */
export interface LoginAttempt {
  _id: string;
  failures: Date[];
  lockedUntil: Date | null;
  expiresAt: Date;
}

const loginAttemptSchema = new Schema<LoginAttempt>(
  {
    _id: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    failures: { type: [Date], default: [] },
    lockedUntil: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'loginAttempts', strict: 'throw', versionKey: false },
);

// Index name and TTL must match migrations/0005-create-login-attempts.ts.
loginAttemptSchema.index({ expiresAt: 1 }, { name: 'expiresAt_ttl', expireAfterSeconds: 0 });

export const LoginAttemptModel: Model<LoginAttempt> =
  (mongoose.models.LoginAttempt as Model<LoginAttempt> | undefined) ??
  model<LoginAttempt>('LoginAttempt', loginAttemptSchema);
