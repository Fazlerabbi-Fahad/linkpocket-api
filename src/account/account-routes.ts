import { deleteAccountSchema } from '../shared/index.js';
import { Router, type RequestHandler } from 'express';
import { clearSessionCookie } from '../auth/cookies.js';
import { rotateCsrf, type CsrfTokens } from '../auth/csrf.js';
import type { AppConfig } from '../config.js';
import type { Clock } from '../lib/clock.js';
import { authOf, requireVerified } from '../middleware/authenticate.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { bodyOf, validateBody } from '../middleware/validate.js';
import type { AccountService } from './account-service.js';

/** SRS 6 account endpoints. Both require a verified user (FR-A3, AC-2). */
export function createAccountRouter(deps: {
  config: AppConfig;
  clock: Clock;
  authenticated: RequestHandler;
  account: AccountService;
  csrf: CsrfTokens;
}): Router {
  const { config, clock, authenticated, account, csrf } = deps;
  const router = Router();

  router.get(
    '/export',
    createRateLimiter(config.rateLimits.accountExport),
    authenticated,
    requireVerified,
    async (req, res) => {
      const data = await account.export(authOf(req).user);
      const day = clock.now().toISOString().slice(0, 10);
      res.set('Cache-Control', 'no-store');
      res.attachment(`linkpocket-export-${day}.json`);
      res.json(data);
    },
  );

  router.delete(
    '/',
    createRateLimiter(config.rateLimits.accountDelete),
    authenticated,
    requireVerified,
    validateBody(deleteAccountSchema),
    async (req, res) => {
      await account.delete(authOf(req).user, bodyOf(deleteAccountSchema, req.body).password);
      clearSessionCookie(res);
      rotateCsrf(res, csrf, null);
      res.status(204).end();
    },
  );

  return router;
}
