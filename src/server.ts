import { createApp, createEmailDispatcher } from './app.js';
import { loadConfig } from './config.js';
import { connectDb, disconnectDb } from './db/connection.js';
import { createSentryReporter, noopReporter } from './lib/error-reporter.js';
import { createLogger } from './lib/logger.js';

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: use the real environment (staging and production).
  }
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const errorReporter = config.sentry
    ? createSentryReporter({ ...config.sentry, environment: config.appEnv })
    : noopReporter;
  if (config.rateLimitMultiplier !== 1) {
    logger.warn(
      { event: 'rate_limits_scaled', multiplier: config.rateLimitMultiplier },
      'rate limits raised for a load test',
    );
  }

  await connectDb(config.mongoUri);
  const emailDispatcher = createEmailDispatcher(config, logger);
  const server = createApp({ config, logger, emailDispatcher, errorReporter }).listen(
    config.port,
    () => {
      logger.info({ port: config.port, appEnv: config.appEnv }, 'api listening');
    },
  );

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      // Let queued verification emails finish (NFR-A4) before closing the database.
      void emailDispatcher
        .idle()
        .then(disconnectDb)
        .then(() => errorReporter.flush(2000))
        .finally(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'API failed to start');
  process.exit(1);
});
