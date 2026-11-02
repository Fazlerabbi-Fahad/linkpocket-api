import { loadConfig } from '../config.js';
import { connectDb, disconnectDb } from '../db/connection.js';
import { createLogger } from '../lib/logger.js';
import { bootstrapAdmin } from './bootstrap.js';

/**
 * `pnpm --filter @linkpocket/api admin:bootstrap` with ADMIN_BOOTSTRAP_EMAIL set.
 * See docs/runbooks/admin-bootstrap.md. Exits non-zero when the account does not exist.
 */
async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: use the real environment.
  }
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  if (!email) throw new Error('ADMIN_BOOTSTRAP_EMAIL is not set');
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  await connectDb(config.mongoUri);
  try {
    const result = await bootstrapAdmin(email, logger);
    if (result === 'not_found') process.exitCode = 1;
  } finally {
    await disconnectDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Admin bootstrap failed');
  process.exit(1);
});
