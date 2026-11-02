import { afterAll, beforeAll } from 'vitest';
import { migrateUp, migrations } from '../src/db/migrations/index.js';
import { connectTestDb, dropTestDb } from './db.js';

/** Registers hooks that give the test file a fresh database with all migrations applied. */
export function useMigratedDb(): void {
  beforeAll(async () => {
    const db = await connectTestDb();
    await migrateUp(db, migrations);
  });
  afterAll(dropTestDb);
}
