import {
  collectionExists,
  createIndexes,
  dropCollectionIfEmpty,
  dropIndexesIfPresent,
  ensureCollection,
} from './helpers.js';
import type { IndexSpec, Migration } from './types.js';

const COLLECTION = 'loginAttempts';

// FR-A9 / OQ-9: lockout records delete themselves once the window or lock has passed.
const INDEXES: IndexSpec[] = [
  { key: { expiresAt: 1 }, name: 'expiresAt_ttl', expireAfterSeconds: 0 },
];

export const migration: Migration = {
  id: '0005-create-login-attempts',
  description: 'Create loginAttempts collection with a TTL index (FR-A9, OQ-9)',
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
