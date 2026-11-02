import { RESOURCE_LIMITS, isHttpUrl } from '../../shared/index.js';
import type { Types } from 'mongoose';
import mongoose, { Schema, model, type HydratedDocument, type Model } from 'mongoose';
import { RESOURCES_CREATED_AT_INDEX } from '../migrations/0008-index-resources-created-at.js';

/** SRS Section 5.2. */
export interface Resource {
  userId: Types.ObjectId;
  url: string;
  title: string;
  note: string;
  tags: string[];
  isPinned: boolean;
  pinnedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ResourceDocument = HydratedDocument<Resource>;

const resourceSchema = new Schema<Resource>(
  {
    // NFR-S4: set by services from req.user only; never changes after creation.
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    url: {
      type: String,
      required: true,
      maxlength: RESOURCE_LIMITS.urlMax,
      match: /^https?:\/\//i,
      validate: { validator: isHttpUrl, message: 'url must be a valid http(s) URL' },
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: RESOURCE_LIMITS.titleMax,
    },
    note: { type: String, default: '', maxlength: RESOURCE_LIMITS.noteMax },
    tags: {
      type: [
        {
          type: String,
          lowercase: true,
          trim: true,
          minlength: 1,
          maxlength: RESOURCE_LIMITS.tagMax,
        },
      ],
      default: [],
      validate: {
        validator: (tags: string[]) => tags.length <= RESOURCE_LIMITS.tagsMax,
        message: `At most ${RESOURCE_LIMITS.tagsMax} tags`,
      },
    },
    isPinned: { type: Boolean, required: true, default: false },
    pinnedAt: { type: Date, default: null },
  },
  {
    collection: 'resources',
    strict: 'throw',
    versionKey: false,
    timestamps: true,
  },
);

// FR-L1 ordering depends on pinnedAt being set exactly when the resource is pinned.
resourceSchema.pre('validate', function () {
  if (this.isPinned && !this.pinnedAt)
    this.invalidate('pinnedAt', 'pinnedAt is required when pinned');
  if (!this.isPinned && this.pinnedAt)
    this.invalidate('pinnedAt', 'pinnedAt must be null when unpinned');
});

// Index names must match migrations/0002-create-resources.ts (see the drift test).
resourceSchema.index(
  { userId: 1, isPinned: -1, pinnedAt: -1, createdAt: -1 },
  { name: 'library_order' },
);
resourceSchema.index({ userId: 1, tags: 1 }, { name: 'userId_tags' });
resourceSchema.index({ userId: 1, createdAt: -1 }, { name: 'userId_createdAt' });
// migrations/0008: admin counts across all users (OQ-7).
resourceSchema.index(RESOURCES_CREATED_AT_INDEX.key, { name: RESOURCES_CREATED_AT_INDEX.name });
resourceSchema.index(
  { title: 'text', note: 'text', tags: 'text', url: 'text' },
  { name: 'resource_text' },
);

export const ResourceModel: Model<Resource> =
  (mongoose.models.Resource as Model<Resource> | undefined) ??
  model<Resource>('Resource', resourceSchema);
