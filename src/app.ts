import { API_PREFIX, REQUEST_BODY_LIMIT } from './shared/index.js';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { createAuthRouter } from './auth/auth-routes.js';
import { AuthService } from './auth/auth-service.js';
import { CSRF_HEADER } from './auth/cookies.js';
import { CsrfTokens, csrfProtection } from './auth/csrf.js';
import { EmailVerificationService } from './auth/email-verification.js';
import { LoginLockout } from './auth/login-lockout.js';
import { PasswordHasher } from './auth/password-hasher.js';
import {
  HibpBreachChecker,
  PasswordScreener,
  loadCommonPasswords,
  type BreachChecker,
} from './auth/password-screening.js';
import { SessionService } from './auth/session-service.js';
import { SessionTokens } from './auth/session-tokens.js';
import { AccountService } from './account/account-service.js';
import { createAdminRouter } from './admin/admin-routes.js';
import { AdminService } from './admin/admin-service.js';
import { createAccountRouter } from './account/account-routes.js';
import type { AppConfig } from './config.js';
import { EmailDispatcher } from './email/dispatcher.js';
import { FileOutboxTransport } from './email/file-outbox-transport.js';
import { LogEmailTransport } from './email/log-transport.js';
import { ResendTransport } from './email/resend-transport.js';
import { VerificationMailer } from './email/verification-mailer.js';
import { systemClock, type Clock } from './lib/clock.js';
import { noopReporter, type ErrorReporter } from './lib/error-reporter.js';
import type { Logger } from './lib/logger.js';
import { readinessHandler } from './lib/readiness.js';
import { recordRouteBase, requestLogger } from './lib/request-log.js';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createRateLimiter } from './middleware/rate-limit.js';
import { requireUser } from './middleware/authenticate.js';
import { rejectMongoOperators } from './middleware/validate.js';
import { createResourceRouter } from './resources/resource-routes.js';
import { ResourceService } from './resources/resource-service.js';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  clock?: Clock;
  /** Overrides the HIBP client (tests). `null` disables the breach check. */
  breachChecker?: BreachChecker | null;
  commonPasswords?: ReadonlySet<string>;
  /** Overrides email delivery (tests use a fake transport). */
  emailDispatcher?: EmailDispatcher;
  /** Sentry in staging and production (NFR-O2); nothing by default. */
  errorReporter?: ErrorReporter;
  /** Overrides the /readyz dependency checks (tests). */
  dependencyChecks?: { database?: () => Promise<boolean>; email?: () => Promise<boolean> };
}

/** NFR-A2: the Mongoose connection is open and the server answers a ping. */
async function pingDatabase(): Promise<boolean> {
  const db = mongoose.connection.db;
  if (mongoose.connection.readyState !== mongoose.ConnectionStates.connected || !db) return false;
  const reply = await db.command({ ping: 1 });
  return reply.ok === 1;
}

/** Resend when configured; otherwise (development, test) emails go to the log. */
export function createEmailDispatcher(config: AppConfig, logger: Logger): EmailDispatcher {
  const transport = config.emailOutboxDir
    ? new FileOutboxTransport(config.emailOutboxDir)
    : config.email
      ? new ResendTransport(config.email.resendApiKey, config.email.from)
      : new LogEmailTransport(logger);
  return new EmailDispatcher(transport, logger);
}

export function createApp(deps: AppDeps): Express {
  const { config, logger } = deps;
  const clock = deps.clock ?? systemClock;
  const emailDispatcher = deps.emailDispatcher ?? createEmailDispatcher(config, logger);

  const tokens = new SessionTokens(config.jwtSecret);
  const csrf = new CsrfTokens(config.jwtSecret);
  const sessions = new SessionService(tokens, clock);
  const breachChecker =
    deps.breachChecker !== undefined
      ? deps.breachChecker
      : config.hibpEnabled
        ? new HibpBreachChecker()
        : null;
  const screener = new PasswordScreener(
    deps.commonPasswords ?? loadCommonPasswords(),
    breachChecker,
    logger,
  );
  const verification = new EmailVerificationService({
    clock,
    mailer: new VerificationMailer(emailDispatcher, config.webOrigin),
    sessions,
  });
  const auth = new AuthService({
    clock,
    hasher: new PasswordHasher(config.passwordHash),
    screener,
    lockout: new LoginLockout(clock),
    sessions,
    verification,
  });

  const resources = new ResourceService(clock);
  const account = new AccountService(clock, auth, resources);
  const admin = new AdminService(clock, auth);
  const authenticated = requireUser(sessions, clock);

  const app = express();
  app.disable('x-powered-by');
  // ADR-0002: trust exactly the proxy hops in front of us, so req.ip is the client's address.
  app.set('trust proxy', config.trustProxyHops);

  app.use(requestLogger(logger)); // NFR-O1, NFR-B6
  app.use(helmet());
  // NFR-S11: only the web origin. The web app normally calls through its own proxy (ADR-0002).
  app.use(
    cors({
      origin: config.webOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', CSRF_HEADER],
    }),
  );

  // NFR-A2: liveness (the process answers) and readiness (its dependencies answer).
  app.get('/healthz', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'ok' });
  });
  app.get(
    '/readyz',
    readinessHandler(
      [
        {
          name: 'database',
          critical: true,
          cacheMs: 0,
          timeoutMs: 2000,
          run: deps.dependencyChecks?.database ?? pingDatabase,
        },
        {
          name: 'email',
          critical: false,
          cacheMs: 60_000,
          timeoutMs: 3000,
          run: deps.dependencyChecks?.email ?? (() => emailDispatcher.checkProvider()),
        },
      ],
      clock,
    ),
  );

  const api = express.Router();
  api.use(createRateLimiter(config.rateLimits.global));
  api.use(express.json({ limit: REQUEST_BODY_LIMIT })); // NFR-S7
  api.use(cookieParser());
  api.use(rejectMongoOperators); // NFR-S6
  api.use(csrfProtection(csrf, tokens, clock)); // NFR-S10
  api.use(
    '/auth',
    recordRouteBase,
    createAuthRouter({ config, clock, auth, sessions, tokens, csrf, verification }),
  );
  api.use('/resources', recordRouteBase, createResourceRouter(authenticated, resources));
  api.use(
    '/account',
    recordRouteBase,
    createAccountRouter({ config, clock, authenticated, account, csrf }),
  );
  api.use('/admin', recordRouteBase, createAdminRouter({ config, authenticated, admin }));
  app.use(API_PREFIX, api);

  app.use(notFoundHandler);
  app.use(createErrorHandler(deps.errorReporter ?? noopReporter));
  return app;
}
