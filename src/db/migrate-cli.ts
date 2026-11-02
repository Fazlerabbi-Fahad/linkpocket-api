/**
 * Usage (from apps/api):
 *   pnpm migrate status
 *   pnpm migrate up [--to <id>]
 *   pnpm migrate down [--steps <n>]
 *   pnpm migrate unlock
 * Reads MONGODB_URI from the environment (or apps/api/.env locally). The URI is never logged.
 */
import { parseArgs } from 'node:util';
import { connectDb, disconnectDb, getDb } from './connection.js';
import {
  migrateDown,
  migrateUp,
  migrationStatus,
  migrations,
  releaseMigrationLock,
  type MigrationLogger,
} from './migrations/index.js';

const log: MigrationLogger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(`warning: ${message}`),
};

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: rely on the real environment (staging and production).
  }

  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { to: { type: 'string' }, steps: { type: 'string' } },
  });
  const command = positionals[0] ?? 'status';
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await connectDb(uri);
  const db = getDb();
  try {
    switch (command) {
      case 'status': {
        for (const row of await migrationStatus(db, migrations)) {
          console.log(`${row.appliedAt ? 'applied' : 'pending'}  ${row.id}  ${row.description}`);
        }
        break;
      }
      case 'up': {
        const done = await migrateUp(db, migrations, {
          ...(values.to ? { to: values.to } : {}),
          log,
        });
        log.info(done.length ? `Applied ${done.length} migration(s).` : 'Nothing to apply.');
        break;
      }
      case 'down': {
        const steps = values.steps ? Number(values.steps) : 1;
        const done = await migrateDown(db, migrations, { steps, log });
        log.info(done.length ? `Reverted ${done.length} migration(s).` : 'Nothing to revert.');
        break;
      }
      case 'unlock': {
        log.info((await releaseMigrationLock(db)) ? 'Lock released.' : 'No lock was held.');
        break;
      }
      default:
        throw new Error(`Unknown command "${command}"`);
    }
  } finally {
    await disconnectDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Migration failed');
  process.exitCode = 1;
});
