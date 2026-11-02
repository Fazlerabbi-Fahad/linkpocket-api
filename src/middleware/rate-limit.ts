import { buildErrorResponse } from '../shared/index.js';
import { rateLimit } from 'express-rate-limit';
import type { RequestHandler } from 'express';
import type { RateLimitRule } from '../config.js';
import { requestIdOf } from './error-handler.js';

/**
 * NFR-S14 per-IP limits. Uses the in-memory store, which is correct for a single API
 * instance; running more than one instance needs a shared store (OQ-18).
 */
export function createRateLimiter(rule: RateLimitRule): RequestHandler {
  return rateLimit({
    windowMs: rule.windowMs,
    limit: rule.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json(buildErrorResponse('RATE_LIMITED', requestIdOf(req)));
    },
  });
}
