import { buildErrorResponse, type ErrorCode, ERROR_STATUS } from '../shared/index.js';
import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/app-error.js';
import { noopReporter, type ErrorReporter } from '../lib/error-reporter.js';
import { routeTemplate } from '../lib/request-log.js';

export function requestIdOf(req: { id?: unknown }): string {
  if (typeof req.id === 'string') return req.id;
  if (typeof req.id === 'number') return String(req.id);
  return 'unknown';
}

/** body-parser errors carry a `type`; map the ones a client can cause. */
function bodyParserCode(error: unknown): ErrorCode | null {
  if (typeof error !== 'object' || error === null || !('type' in error)) return null;
  switch (error.type) {
    case 'entity.too.large':
      return 'PAYLOAD_TOO_LARGE';
    case 'entity.parse.failed':
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return 'VALIDATION_FAILED';
    default:
      return null;
  }
}

/** Sends the error envelope and records the code for the request log (NFR-O3 failed logins). */
function sendError(res: Response, status: number, body: ReturnType<typeof buildErrorResponse>) {
  res.locals.errorCode = body.error.code;
  res.status(status).json(body);
}

export const notFoundHandler: RequestHandler = (req, res) => {
  sendError(res, 404, buildErrorResponse('NOT_FOUND', requestIdOf(req)));
};

/**
 * NFR-S8: clients get a code, a generic message and the request ID. Stack traces only go to
 * the server log and the error reporter (NFR-O2), keyed by the same request ID.
 */
export function createErrorHandler(reporter: ErrorReporter): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    const requestId = requestIdOf(req);

    if (error instanceof AppError) {
      sendError(res, error.status, buildErrorResponse(error.code, requestId, error.fields));
      return;
    }
    if (error instanceof ZodError) {
      const fields = error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      sendError(res, 400, buildErrorResponse('VALIDATION_FAILED', requestId, fields));
      return;
    }
    const parserCode = bodyParserCode(error);
    if (parserCode) {
      sendError(res, ERROR_STATUS[parserCode], buildErrorResponse(parserCode, requestId));
      return;
    }

    req.log.error({ err: error, requestId }, 'unhandled error');
    reporter.capture(error, {
      requestId,
      route: routeTemplate(req, res),
      ...(req.auth ? { userId: req.auth.user._id.toHexString() } : {}),
    });
    if (res.headersSent) return;
    sendError(res, 500, buildErrorResponse('INTERNAL', requestId));
  };
}

export const errorHandler: ErrorRequestHandler = createErrorHandler(noopReporter);
