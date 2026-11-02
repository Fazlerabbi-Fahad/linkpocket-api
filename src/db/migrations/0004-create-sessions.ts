import {
  collectionExists,
  createIndexes,
  dropCollectionIfEmpty,
  dropIndexesIfPresent,
  ensureCollection,
} from './helpers.js';
import type { IndexSpec, Migration } from './types.js';

const COLLECTION = 'sessions';

// Clarification 1 / ADR-0001. Records are removed by TTL once expiresAt passes.
const INDEXES: IndexSpec[] = [
  { key: { jti: 1 }, name: 'jti_unique', unique: true },
  { key: { userId: 1, createdAt: -1 }, name: 'userId_createdAt' },
  { key: { expiresAt: 1 }, name: 'expiresAt_ttl', expireAfterSeconds: 0 },
];

export const migration: Migration = {
  id: '0004-create-sessions',
  description: 'Create sessions collection with jti and TTL indexes (ADR-0001)',
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
