import { scrubErrorEvent } from '../shared/index.js';
import * as Sentry from '@sentry/node';

export interface ErrorContext {
  requestId: string;
  route: string;
  userId?: string;
}

/** NFR-O2: where unexpected (500) errors go besides the log. */
export interface ErrorReporter {
  capture(error: unknown, context: ErrorContext): void;
  /** Waits for queued reports before the process exits. */
  flush(timeoutMs: number): Promise<void>;
}

export const noopReporter: ErrorReporter = {
  capture: () => {},
  flush: () => Promise.resolve(),
};

export interface SentryOptions {
  dsn: string;
  environment: string;
  release: string | undefined;
}

/**
 * Sentry for the API. No performance tracing and no automatic HTTP instrumentation: only
 * errors, each scrubbed of request data, users, breadcrumbs, URLs and emails (NFR-B6).
 * Source maps are uploaded at build time (docs/runbooks/observability.md).
 */
export function createSentryReporter(options: SentryOptions): ErrorReporter {
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    ...(options.release ? { release: options.release } : {}),
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    defaultIntegrations: false,
    integrations: [
      Sentry.linkedErrorsIntegration(),
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
    ],
    beforeSend: (event) => scrubErrorEvent(event),
  });
  return {
    capture(error, context) {
      Sentry.withScope((scope) => {
        scope.setTag('requestId', context.requestId);
        scope.setTag('route', context.route);
        if (context.userId) scope.setTag('userId', context.userId);
        Sentry.captureException(error);
      });
    },
    async flush(timeoutMs) {
      await Sentry.flush(timeoutMs);
    },
  };
}
