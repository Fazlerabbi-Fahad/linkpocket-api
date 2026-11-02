import {
  collectionExists,
  createIndexes,
  dropCollectionIfEmpty,
  dropIndexesIfPresent,
  ensureCollection,
} from './helpers.js';
import type { IndexSpec, Migration } from './types.js';

const COLLECTION = 'users';

// SRS Section 5.1 indexes.
const INDEXES: IndexSpec[] = [
  { key: { email: 1 }, name: 'email_unique', unique: true },
  { key: { createdAt: -1 }, name: 'createdAt_desc' },
  { key: { lastActiveAt: -1 }, name: 'lastActiveAt_desc' },
  { key: { emailVerifiedAt: 1, createdAt: 1 }, name: 'emailVerifiedAt_createdAt' },
];

export const migration: Migration = {
  id: '0001-create-users',
  description: 'Create users collection and indexes (SRS 5.1)',
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
