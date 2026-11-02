import {
  collectionExists,
  createIndexes,
  dropCollectionIfEmpty,
  dropIndexesIfPresent,
  ensureCollection,
} from './helpers.js';
import type { IndexSpec, Migration } from './types.js';

const COLLECTION = 'verificationThrottles';

// FR-A4 / OQ-25: throttle records delete themselves an hour after the last request.
const INDEXES: IndexSpec[] = [
  { key: { expiresAt: 1 }, name: 'expiresAt_ttl', expireAfterSeconds: 0 },
];

export const migration: Migration = {
  id: '0007-create-verification-throttles',
  description: 'Create verificationThrottles collection with a TTL index (FR-A4, OQ-25)',
  async up(db) {
    await ensureCollection(db, COLLECTION);
    await createIndexes(db, COLLECTION, INDEXES);
  },
  async down(db, log) {
    if (!(await collectionExists(db, COLLECTION))) return;
    await dropIndexesIfPresent(
      db,
      COLLECTION,
      INDEXES.map((index) => index.name),
    );
    await dropCollectionIfEmpty(db, COLLECTION, log);
  },
};
