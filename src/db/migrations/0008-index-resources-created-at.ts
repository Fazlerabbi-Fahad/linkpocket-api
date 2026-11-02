import { collectionExists, createIndexes, dropIndexesIfPresent } from './helpers.js';
import type { IndexSpec, Migration } from './types.js';

const COLLECTION = 'resources';

/**
 * OQ-7: the admin overview counts links added today, in 7 and in 30 days, and per day for the
 * trend, across all users (FR-AD3, FR-AD4). `{ userId, createdAt }` cannot serve a query
 * without a userId, so those counts need their own index (NFR-P4).
 */
export const RESOURCES_CREATED_AT_INDEX = {
  key: { createdAt: -1 },
  name: 'createdAt_desc',
} as const satisfies IndexSpec;

export const migration: Migration = {
  id: '0008-index-resources-created-at',
  description: 'Index resources by createdAt for admin counts (FR-AD3, FR-AD4, OQ-7)',
  async up(db) {
    await createIndexes(db, COLLECTION, [RESOURCES_CREATED_AT_INDEX]);
  },
  async down(db) {
    if (!(await collectionExists(db, COLLECTION))) return;
    await dropIndexesIfPresent(db, COLLECTION, [RESOURCES_CREATED_AT_INDEX.name]);
  },
};
