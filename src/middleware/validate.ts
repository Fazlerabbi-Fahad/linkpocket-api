import { hasMongoOperatorKeys } from '../shared/index.js';
import type { RequestHandler } from 'express';
import type { z } from 'zod';
import { AppError } from '../lib/app-error.js';

/** NFR-S6: reject `$`-prefixed keys anywhere in the body, query or params. */
export const rejectMongoOperators: RequestHandler = (req, _res, next) => {
  if (
    hasMongoOperatorKeys(req.body) ||
    hasMongoOperatorKeys(req.query) ||
    hasMongoOperatorKeys(req.params)
  ) {
    next(new AppError('VALIDATION_FAILED', [{ path: '', message: 'Invalid input.' }]));
    return;
  }
  next();
};

/** Parses req.body with a shared Zod schema and replaces it with the parsed output. */
export function validateBody<S extends z.ZodType>(schema: S): RequestHandler {
  return (req, _res, next) => {
    req.body = schema.parse(req.body ?? {}) as unknown;
    next();
  };
}

/** Parsed body for a route that used validateBody(schema). */
export function bodyOf<S extends z.ZodType>(_schema: S, body: unknown): z.output<S> {
  return body as z.output<S>;
}
