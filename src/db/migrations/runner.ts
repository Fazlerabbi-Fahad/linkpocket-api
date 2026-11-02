import type { Db, Migration, MigrationLogger } from './types.js';

export const MIGRATIONS_COLLECTION = '_migrations';
export const LOCK_COLLECTION = '_migrations_lock';
const LOCK_ID = 'migrate';

interface AppliedRecord {
  _id: string;
  description: string;
  appliedAt: Date;
}

interface LockRecord {
  _id: string;
  lockedAt: Date;
}

export interface MigrationStatus {
  id: string;
  description: string;
  appliedAt: Date | null;
}

const silentLogger: MigrationLogger = { info: () => {}, warn: () => {} };

export class MigrationError extends Error {
  override name = 'MigrationError';
}

function assertValidRegistry(migrations: readonly Migration[]): void {
  const ids = migrations.map((migration) => migration.id);
  if (new Set(ids).size !== ids.length) throw new MigrationError('Duplicate migration ids');
  const sorted = [...ids].sort();
  if (ids.some((id, i) => id !== sorted[i])) {
    throw new MigrationError('Migrations must be registered in ascending id order');
  }
}

async function appliedRecords(db: Db): Promise<AppliedRecord[]> {
  return db.collection<AppliedRecord>(MIGRATIONS_COLLECTION).find().sort({ _id: 1 }).toArray();
}

/** Applied migrations must be a prefix of the registry; anything else means drift. */
function assertConsistent(migrations: readonly Migration[], applied: AppliedRecord[]): void {
  applied.forEach((record, i) => {
    if (migrations[i]?.id !== record._id) {
      throw new MigrationError(
        `Database has migration "${record._id}" that does not match the registry at position ${i}`,
      );
    }
  });
}

/** A single lock document prevents two deploys from migrating at the same time. */
async function withLock<T>(db: Db, run: () => Promise<T>): Promise<T> {
  const locks = db.collection<LockRecord>(LOCK_COLLECTION);
  try {
    await locks.insertOne({ _id: LOCK_ID, lockedAt: new Date() });
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw new MigrationError(
        'Another migration run holds the lock. Use "unlock" if it is stale.',
      );
    }
    throw error;
  }
  try {
    return await run();
  } finally {
    await locks.deleteOne({ _id: LOCK_ID });
  }
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

export async function migrationStatus(
  db: Db,
  migrations: readonly Migration[],
): Promise<MigrationStatus[]> {
  assertValidRegistry(migrations);
  const applied = new Map((await appliedRecords(db)).map((record) => [record._id, record]));
  return migrations.map(({ id, description }) => ({
    id,
    description,
    appliedAt: applied.get(id)?.appliedAt ?? null,
  }));
}

/** Applies pending migrations in order, optionally stopping after `to`. Returns applied ids. */
export async function migrateUp(
  db: Db,
  migrations: readonly Migration[],
  options: { to?: string; log?: MigrationLogger } = {},
): Promise<string[]> {
  assertValidRegistry(migrations);
  const log = options.log ?? silentLogger;
  if (options.to !== undefined && !migrations.some((m) => m.id === options.to)) {
    throw new MigrationError(`Unknown migration "${options.to}"`);
  }

  return withLock(db, async () => {
    const applied = await appliedRecords(db);
    assertConsistent(migrations, applied);
    const done: string[] = [];
    for (const migration of migrations.slice(applied.length)) {
      log.info(`up   ${migration.id}: ${migration.description}`);
      await migration.up(db, log);
      await db.collection<AppliedRecord>(MIGRATIONS_COLLECTION).insertOne({
        _id: migration.id,
        description: migration.description,
        appliedAt: new Date(),
      });
      done.push(migration.id);
      if (migration.id === options.to) break;
    }
    return done;
  });
}

/** Reverts the most recent `steps` applied migrations (default 1). Returns reverted ids. */
export async function migrateDown(
  db: Db,
  migrations: readonly Migration[],
  options: { steps?: number; log?: MigrationLogger } = {},
): Promise<string[]> {
  assertValidRegistry(migrations);
  const log = options.log ?? silentLogger;
  const steps = options.steps ?? 1;
  if (!Number.isInteger(steps) || steps < 1)
    throw new MigrationError('steps must be a positive integer');

  return withLock(db, async () => {
    const applied = await appliedRecords(db);
    assertConsistent(migrations, applied);
    const toRevert = migrations.slice(0, applied.length).slice(-steps).reverse();
    const done: string[] = [];
    for (const migration of toRevert) {
      log.info(`down ${migration.id}: ${migration.description}`);
      await migration.down(db, log);
      await db.collection<AppliedRecord>(MIGRATIONS_COLLECTION).deleteOne({ _id: migration.id });
      done.push(migration.id);
    }
    return done;
  });
}

/** Clears a lock left by a crashed run. Operators only; see the deployment runbook. */
export async function releaseMigrationLock(db: Db): Promise<boolean> {
  const result = await db.collection<LockRecord>(LOCK_COLLECTION).deleteOne({ _id: LOCK_ID });
  return result.deletedCount === 1;
}
