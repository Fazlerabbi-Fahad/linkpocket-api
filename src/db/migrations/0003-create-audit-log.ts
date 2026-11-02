import {
  collectionExists,
  createIndexes,
  dropCollectionIfEmpty,
  dropIndexesIfPresent,
  ensureCollection,
} from './helpers.js';
import type { IndexSpec, Migration } from './types.js';

const COLLECTION = 'auditLog';

// SRS Section 5.3: { createdAt: -1 } doubles as the 1-year TTL index (NFR-B5).
const INDEXES: IndexSpec[] = [
  { key: { createdAt: -1 }, name: 'createdAt_ttl', expireAfterSeconds: 365 * 24 * 60 * 60 },
];

export const migration: Migration = {
  id: '0003-create-audit-log',
  description: 'Create auditLog collection with a 1-year TTL index (SRS 5.3, NFR-B5)',
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
