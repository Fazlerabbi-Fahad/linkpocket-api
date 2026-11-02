import mongoose, { Schema, model, type Model } from 'mongoose';

/**
 * FR-A4 resend counting for addresses that have no unverified account (OQ-25), so that
 * resend answers the same way for every address (NFR-S15). Unverified accounts are counted
 * in `users.verificationEmailSentAt` instead. Keyed by SHA-256 of the normalized email.
 */
export interface VerificationThrottle {
  _id: string;
  sentAt: Date[];
  expiresAt: Date;
}

const verificationThrottleSchema = new Schema<VerificationThrottle>(
  {
    _id: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    sentAt: { type: [Date], default: [] },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'verificationThrottles', strict: 'throw', versionKey: false },
);

// Index name and TTL must match migrations/0007-create-verification-throttles.ts.
verificationThrottleSchema.index(
  { expiresAt: 1 },
  { name: 'expiresAt_ttl', expireAfterSeconds: 0 },
);

export const VerificationThrottleModel: Model<VerificationThrottle> =
  (mongoose.models.VerificationThrottle as Model<VerificationThrottle> | undefined) ??
  model<VerificationThrottle>('VerificationThrottle', verificationThrottleSchema);
