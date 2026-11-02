import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { pinoHttp, type HttpLogger } from 'pino-http';
import { serializeError, type Logger } from './logger.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's own extension point
  namespace Express {
    interface Locals {
      /** Mount path of the router that handled the request (see `recordRouteBase`). */
      routeBase?: string;
      /** Error code sent to the client, for the request log (set by the error handler). */
      errorCode?: string;
    }
  }
}

/**
 * Mounted alongside each router, so the request log can name the route template
 * (`/api/v1/resources/:id`) rather than the concrete path with its IDs (NFR-O1).
 */
export const recordRouteBase: RequestHandler = (req, res, next) => {
  res.locals.routeBase = req.baseUrl;
  next();
};

export function routeTemplate(req: Request, res: Response): string {
  const path: unknown = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof path !== 'string') return 'unmatched';
  const base = res.locals.routeBase ?? '';
  return path === '/' && base !== '' ? base : `${base}${path}`;
}

/** Fields added to the completion line of every request. */
function completion(req: Request, res: Response): Record<string, unknown> {
  return {
    route: routeTemplate(req, res),
    ...(res.locals.errorCode ? { errorCode: res.locals.errorCode } : {}),
    // NFR-B6: when a log needs to identify someone, it uses the user ID.
    ...(req.auth ? { userId: req.auth.user._id.toHexString() } : {}),
  };
}

/**
 * NFR-O1: one JSON line per request with request ID, method, route template, status and
 * duration (`responseTime`, ms). NFR-B6: no headers, cookies, bodies or query strings (search
 * terms), and no concrete paths.
 */
export function requestLogger(logger: Logger): HttpLogger<Request, Response> {
  return pinoHttp<Request, Response>({
    logger,
    genReqId: (_req, res) => {
      const id = randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    serializers: {
      req: (req: { id: unknown; method: string }) => ({ id: req.id, method: req.method }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      err: serializeError,
    },
    // Client errors (failed logins, validation) are warnings; server errors are errors.
    customLogLevel: (_req, res, error) =>
      error || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    customSuccessObject: (req, res, val: Record<string, unknown>) => ({
      ...val,
      ...completion(req, res),
    }),
    customErrorObject: (req, res, _error, val: Record<string, unknown>) => ({
      ...val,
      ...completion(req, res),
    }),
  });
}
