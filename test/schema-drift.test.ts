import type { Model } from 'mongoose';
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  AuditLogModel,
  AuthSessionModel,
  LoginAttemptModel,
  ResourceModel,
  VerificationThrottleModel,
  UserModel,
} from '../src/db/models/index.js';
import { useMigratedDb } from './migrated-db.js';

/**
 * Mongoose never builds indexes (autoIndex: false); migrations do. This test fails when a
 * model declares an index that no migration creates, or the other way round.
 */
interface Comparable {
  name: string;
  // Entries, not an object, so that compound key order is part of the comparison.
  key: [string, unknown][];
  unique: boolean;
  expireAfterSeconds: number | null;
  partialFilterExpression: unknown;
}

function isTextIndex(key: Record<string, unknown>): boolean {
  return Object.values(key).includes('text');
}

function fromSchema(model: Model<never>): Comparable[] {
  return model.schema.indexes().map(([key, options]) => ({
    name: String(options.name),
    key: isTextIndex(key) ? [['text', Object.keys(key).sort()]] : Object.entries(key),
    unique: options.unique === true,
    expireAfterSeconds: options.expireAfterSeconds ?? null,
    partialFilterExpression: options.partialFilterExpression ?? null,
  }));
}

async function fromDatabase(collection: string): Promise<Comparable[]> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('not connected');
  const indexes = await db.collection(collection).indexes();
  return indexes
    .filter((index) => index.name !== '_id_')
    .map((index) => ({
      name: String(index.name),
      key: index.weights
        ? [['text', Object.keys(index.weights).sort()]]
        : Object.entries(index.key),
      unique: index.unique === true,
      expireAfterSeconds: index.expireAfterSeconds ?? null,
      partialFilterExpression: index.partialFilterExpression ?? null,
    }));
}

const byName = (a: Comparable, b: Comparable) => a.name.localeCompare(b.name);

describe('model indexes match migrated indexes', () => {
  useMigratedDb();

  it.each([
    ['users', UserModel],
    ['resources', ResourceModel],
    ['auditLog', AuditLogModel],
    ['sessions', AuthSessionModel],
    ['loginAttempts', LoginAttemptModel],
    ['verificationThrottles', VerificationThrottleModel],
  ] as const)('%s', async (collection, model) => {
    expect(model.collection.collectionName).toBe(collection);
    const expected = fromSchema(model as unknown as Model<never>).sort(byName);
    expect((await fromDatabase(collection)).sort(byName)).toEqual(expected);
  });
});
