import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectTestDb, dropTestDb } from '../../../test/db.js';
import {
  LOCK_COLLECTION,
  MigrationError,
  migrateDown,
  migrateUp,
  migrationStatus,
  migrations,
  releaseMigrationLock,
  type Db,
  type Migration,
  type MigrationLogger,
} from './index.js';

const COLLECTIONS = [
  'users',
  'resources',
  'auditLog',
  'sessions',
  'loginAttempts',
  'verificationThrottles',
];
let db: Db;

async function collectionNames(target: Db): Promise<string[]> {
  return (await target.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((name) => !name.startsWith('_'))
    .sort();
}

async function indexNames(target: Db, collection: string): Promise<string[]> {
  return (await target.collection(collection).indexes()).map((i) => String(i.name)).sort();
}

function capturingLogger(): MigrationLogger & { warnings: string[] } {
  const warnings: string[] = [];
  return { info: () => {}, warn: (message) => warnings.push(message), warnings };
}

beforeAll(async () => {
  await connectTestDb();
});
afterAll(dropTestDb);

beforeEach(() => {
  // A fresh database on the same connection for every test.
  db = mongoose.connection.getClient().db(`lp_migr_${randomUUID().slice(0, 8)}`);
});

describe('migrations (NFR-M5)', () => {
  it('applies every migration in order and records it', async () => {
    const applied = await migrateUp(db, migrations);
    expect(applied).toEqual(migrations.map((m) => m.id));
    expect(await collectionNames(db)).toEqual([...COLLECTIONS].sort());

    const status = await migrationStatus(db, migrations);
    expect(status.every((row) => row.appliedAt instanceof Date)).toBe(true);
  });

  it('creates the indexes from SRS Section 5 and the sessions ADR', async () => {
    await migrateUp(db, migrations);
    expect(await indexNames(db, 'users')).toEqual(
      [
        '_id_',
        'createdAt_desc',
        'email_unique',
        'emailVerifiedAt_createdAt',
        'emailVerificationTokenHash_unique',
        'lastActiveAt_desc',
      ].sort(),
    );
    expect(await indexNames(db, 'resources')).toEqual(
      [
        '_id_',
        'createdAt_desc',
        'library_order',
        'resource_text',
        'userId_createdAt',
        'userId_tags',
      ].sort(),
    );
    expect(await indexNames(db, 'auditLog')).toEqual(['_id_', 'createdAt_ttl']);
    expect(await indexNames(db, 'sessions')).toEqual(
      ['_id_', 'expiresAt_ttl', 'jti_unique', 'userId_createdAt'].sort(),
    );
  });

  it('gives the audit log a 1-year TTL (NFR-B5) and sessions an expiresAt TTL', async () => {
    await migrateUp(db, migrations);
    const audit = (await db.collection('auditLog').indexes()).find(
      (i) => i.name === 'createdAt_ttl',
    );
    expect(audit?.expireAfterSeconds).toBe(31_536_000);
    expect(audit?.key).toEqual({ createdAt: -1 });
    const sessions = (await db.collection('sessions').indexes()).find(
      (i) => i.name === 'expiresAt_ttl',
    );
    expect(sessions?.expireAfterSeconds).toBe(0);
  });

  it('is a no-op when everything is applied', async () => {
    await migrateUp(db, migrations);
    expect(await migrateUp(db, migrations)).toEqual([]);
  });

  it('reverts one step by default, and all steps back to an empty database', async () => {
    await migrateUp(db, migrations);
    expect(await migrateDown(db, migrations)).toEqual(['0008-index-resources-created-at']);
    expect(await collectionNames(db)).toEqual([
      'auditLog',
      'loginAttempts',
      'resources',
      'sessions',
      'users',
      'verificationThrottles',
    ]);

    expect(await migrateDown(db, migrations, { steps: 10 })).toEqual([
      '0007-create-verification-throttles',
      '0006-index-verification-token',
      '0005-create-login-attempts',
      '0004-create-sessions',
      '0003-create-audit-log',
      '0002-create-resources',
      '0001-create-users',
    ]);
    expect(await collectionNames(db)).toEqual([]);
    expect((await migrationStatus(db, migrations)).every((row) => row.appliedAt === null)).toBe(
      true,
    );
  });

  it('round-trips up, down, up to the same schema', async () => {
    await migrateUp(db, migrations);
    const before = await Promise.all(COLLECTIONS.map((c) => indexNames(db, c)));
    await migrateDown(db, migrations, { steps: migrations.length });
    await migrateUp(db, migrations);
    const after = await Promise.all(COLLECTIONS.map((c) => indexNames(db, c)));
    expect(after).toEqual(before);
  });

  it('stops after the requested target', async () => {
    expect(await migrateUp(db, migrations, { to: '0002-create-resources' })).toEqual([
      '0001-create-users',
      '0002-create-resources',
    ]);
    await expect(migrateUp(db, migrations, { to: '9999-nope' })).rejects.toBeInstanceOf(
      MigrationError,
    );
  });

  it('never drops a collection that holds data when rolling back (ADR-0003)', async () => {
    await migrateUp(db, migrations);
    await db.collection('users').insertOne({ email: 'keep@example.com' });
    const log = capturingLogger();
    await migrateDown(db, migrations, { steps: migrations.length, log });

    expect(await collectionNames(db)).toEqual(['users']);
    expect(await indexNames(db, 'users')).toEqual(['_id_']);
    expect(await db.collection('users').countDocuments()).toBe(1);
    expect(log.warnings).toEqual(['Kept collection "users" because it contains documents.']);

    // Re-applying recreates the indexes on the kept collection.
    await migrateUp(db, migrations);
    expect(await indexNames(db, 'users')).toContain('email_unique');
  });

  it('rejects a second concurrent run and can release a stale lock', async () => {
    await db.collection<{ _id: string; lockedAt: Date }>(LOCK_COLLECTION).insertOne({
      _id: 'migrate',
      lockedAt: new Date(),
    });
    await expect(migrateUp(db, migrations)).rejects.toThrow(/holds the lock/);
    expect(await releaseMigrationLock(db)).toBe(true);
    expect(await releaseMigrationLock(db)).toBe(false);
    await expect(migrateUp(db, migrations)).resolves.toHaveLength(migrations.length);
  });

  it('releases the lock when a migration fails, without recording it', async () => {
    const failing: Migration = {
      id: '9999-fails',
      description: 'always fails',
      up: () => Promise.reject(new Error('boom')),
      down: () => Promise.resolve(),
    };
    await expect(migrateUp(db, [...migrations, failing])).rejects.toThrow('boom');
    const status = await migrationStatus(db, [...migrations, failing]);
    expect(status.at(-1)?.appliedAt).toBeNull();
    expect(await db.collection(LOCK_COLLECTION).countDocuments()).toBe(0);
  });

  it('detects drift between the database and the registry', async () => {
    await migrateUp(db, migrations);
    await expect(migrateUp(db, migrations.slice(1))).rejects.toThrow(/does not match the registry/);
  });

  it('validates the registry and arguments', async () => {
    const [first, second] = migrations;
    if (!first || !second) throw new Error('registry is empty');
    await expect(migrateUp(db, [first, first])).rejects.toThrow(/Duplicate/);
    await expect(migrateUp(db, [second, first])).rejects.toThrow(/ascending/);
    await expect(migrateDown(db, migrations, { steps: 0 })).rejects.toThrow(/positive integer/);
  });

  it('down is safe when collections are already gone (idempotent)', async () => {
    for (const migration of [...migrations].reverse()) {
      await expect(migration.down(db, capturingLogger())).resolves.toBeUndefined();
    }
  });
});
