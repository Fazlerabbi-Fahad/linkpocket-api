import {
  collectionExists,
  createIndexes,
  dropCollectionIfEmpty,
  dropIndexesIfPresent,
  ensureCollection,
} from './helpers.js';
import type { IndexSpec, Migration } from './types.js';

const COLLECTION = 'resources';

// SRS Section 5.2 indexes.
const INDEXES: IndexSpec[] = [
  { key: { userId: 1, isPinned: -1, pinnedAt: -1, createdAt: -1 }, name: 'library_order' },
  { key: { userId: 1, tags: 1 }, name: 'userId_tags' },
  { key: { userId: 1, createdAt: -1 }, name: 'userId_createdAt' },
  { key: { title: 'text', note: 'text', tags: 'text', url: 'text' }, name: 'resource_text' },
];

export const migration: Migration = {
  id: '0002-create-resources',
  description: 'Create resources collection and indexes (SRS 5.2)',
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
