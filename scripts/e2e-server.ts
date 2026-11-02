/**
 * Starts the API for Playwright (AC-1, AC-5, AC-6): an in-memory MongoDB replica set with
 * all migrations applied, emails written to E2E_OUTBOX_DIR, and generous rate limits so a
 * test run is not throttled. Test-only: no real credentials are used anywhere.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { bootstrapAdmin } from '../src/admin/bootstrap.js';
import { createApp } from '../src/app.js';
import { PasswordHasher } from '../src/auth/password-hasher.js';
import { loadConfig } from '../src/config.js';
import { connectDb, getDb } from '../src/db/connection.js';
import { migrateUp, migrations } from '../src/db/migrations/index.js';
import { UserModel } from '../src/db/models/index.js';
import { createLogger } from '../src/lib/logger.js';

const port = Number(process.env.E2E_API_PORT ?? 4100);
const webOrigin = process.env.E2E_WEB_ORIGIN ?? 'http://localhost:3100';
const outbox = process.env.E2E_OUTBOX_DIR;
if (!outbox) throw new Error('E2E_OUTBOX_DIR is required');

const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
const base = loadConfig({
  NODE_ENV: 'development',
  MONGODB_URI: mongo.getUri('linkpocket_e2e'),
  // Test-only signing secret for a throwaway in-memory database.
  JWT_SECRET: 'e2e-only-secret-'.padEnd(48, 'e'),
  WEB_ORIGIN: webOrigin,
  HIBP_ENABLED: 'false',
  LOG_LEVEL: 'warn',
  EMAIL_OUTBOX_DIR: outbox,
});
const generous = { windowMs: 60_000, limit: 10_000 };
const config = {
  ...base,
  port,
  rateLimits: Object.fromEntries(
    Object.keys(base.rateLimits).map((name) => [name, generous]),
  ) as typeof base.rateLimits,
};

await connectDb(config.mongoUri);
await migrateUp(getDb(), migrations);

// AC-10 E2E: one verified admin, made the way production makes one (sign-up data, then the
// bootstrap script). Test-only address and password for a throwaway in-memory database.
const E2E_ADMIN_EMAIL = 'admin@example.test';
const E2E_ADMIN_PASSWORD = 'correct horse battery staple';
await UserModel.create({
  email: E2E_ADMIN_EMAIL,
  passwordHash: await new PasswordHasher(config.passwordHash).hash(E2E_ADMIN_PASSWORD),
  privacyPolicyAcceptedAt: new Date(),
  emailVerifiedAt: new Date(),
});
await bootstrapAdmin(E2E_ADMIN_EMAIL, createLogger('silent'));
const logger = createLogger(config.logLevel);
const server = createApp({ config, logger }).listen(port, () => {
  logger.warn({ port }, 'e2e api listening');
});

async function stop(): Promise<void> {
  server.close();
  await mongo.stop();
  process.exit(0);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
