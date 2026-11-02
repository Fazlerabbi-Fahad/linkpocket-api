import { AUDIT_ACTIONS, RETENTION, isAuditActorId, type AuditAction } from '../../shared/index.js';
import type { Types } from 'mongoose';
import mongoose, { Schema, model, type HydratedDocument, type Model } from 'mongoose';

/**
 * SRS Section 5.3. FR-D3: entries hold IDs, an action and a timestamp, nothing else.
 * Clarification 3: actorId is a string, either an ObjectId hex string or "system".
 */
export interface AuditLogEntry {
  actorId: string;
  targetUserId: Types.ObjectId | null;
  action: AuditAction;
  createdAt: Date;
}

export type AuditLogDocument = HydratedDocument<AuditLogEntry>;

const auditLogSchema = new Schema<AuditLogEntry>(
  {
    actorId: {
      type: String,
      required: true,
      immutable: true,
      validate: { validator: isAuditActorId, message: 'actorId must be an ObjectId or "system"' },
    },
    targetUserId: { type: Schema.Types.ObjectId, default: null, immutable: true },
    action: { type: String, enum: AUDIT_ACTIONS, required: true, immutable: true },
    createdAt: { type: Date, required: true, immutable: true, default: () => new Date() },
  },
  { collection: 'auditLog', strict: 'throw', versionKey: false },
);

// The audit log is append-only: entries expire through the TTL index, never by edits.
function rejectMutation(): never {
  throw new Error('auditLog is append-only');
}
auditLogSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'],
  rejectMutation,
);
auditLogSchema.pre('save', function () {
  if (!this.isNew) rejectMutation();
});

// Index name and TTL must match migrations/0003-create-audit-log.ts (NFR-B5).
auditLogSchema.index(
  { createdAt: -1 },
  { name: 'createdAt_ttl', expireAfterSeconds: RETENTION.auditLogSeconds },
);

export const AuditLogModel: Model<AuditLogEntry> =
  (mongoose.models.AuditLog as Model<AuditLogEntry> | undefined) ??
  model<AuditLogEntry>('AuditLog', auditLogSchema);
