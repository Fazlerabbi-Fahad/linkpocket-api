import { collectionExists, createIndexes, dropIndexesIfPresent } from './helpers.js';
import type { IndexSpec, Migration } from './types.js';

const COLLECTION = 'users';

/**
 * FR-A5 looks an account up by the SHA-256 of its verification token (NFR-S9). SRS 5.1 lists
 * no index for it, so without this every verify request would scan the collection. Partial,
 * so the many accounts with no pending token (null) are not indexed and do not collide.
 */
export const VERIFICATION_TOKEN_INDEX = {
  key: { emailVerificationTokenHash: 1 },
  name: 'emailVerificationTokenHash_unique',
  unique: true,
  partialFilterExpression: { emailVerificationTokenHash: { $type: 'string' } },
} as const satisfies IndexSpec;

export const migration: Migration = {
  id: '0006-index-verification-token',
  description: 'Index users by verification token hash (FR-A5, NFR-S9)',
  async up(db) {
    await createIndexes(db, COLLECTION, [VERIFICATION_TOKEN_INDEX]);
  },
  async down(db) {
    if (!(await collectionExists(db, COLLECTION))) return;
    await dropIndexesIfPresent(db, COLLECTION, [VERIFICATION_TOKEN_INDEX.name]);
  },
};
