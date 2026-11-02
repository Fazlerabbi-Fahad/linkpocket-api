import { loadConfig } from '../config.js';
import { connectDb, disconnectDb } from '../db/connection.js';
import { systemClock } from '../lib/clock.js';
import { createLogger } from '../lib/logger.js';
import { CLEANUP_UNVERIFIED_JOB, runCleanupUnverified } from './cleanup-unverified.js';

/**
 * One-shot job runner for the hosting provider's cron (SRS 7: "Render cron job"), for
 * example daily: `node dist/jobs/cli.js cleanup-unverified`. Exits non-zero on failure so
 * the platform reports it (NFR-O3). See docs/runbooks/scheduled-jobs.md.
 */
async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: use the real environment.
  }
  const job = process.argv[2];
  if (job !== CLEANUP_UNVERIFIED_JOB) {
    throw new Error(`Unknown job. Available: ${CLEANUP_UNVERIFIED_JOB}`);
  }
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  await connectDb(config.mongoUri);
  try {
    await runCleanupUnverified(systemClock, logger);
  } finally {
    await disconnectDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Job failed');
  process.exit(1);
});
