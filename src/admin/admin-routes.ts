import { adminUserStatusSchema, adminUsersQuerySchema } from '../shared/index.js';
import { Router, type RequestHandler } from 'express';
import type { AppConfig } from '../config.js';
import { authOf, requireAdmin, requireVerified } from '../middleware/authenticate.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { bodyOf, validateBody } from '../middleware/validate.js';
import type { AdminService } from './admin-service.js';

/**
 * SRS 6 admin endpoints. FR-AD1, FR-AD2, NFR-S5: every request is rate limited (NFR-S14),
 * then checked on the server for a valid session, a verified email and the admin role.
 */
export function createAdminRouter(deps: {
  config: AppConfig;
  authenticated: RequestHandler;
  admin: AdminService;
}): Router {
  const { config, authenticated, admin } = deps;
  const router = Router();
  router.use(
    createRateLimiter(config.rateLimits.admin),
    authenticated,
    requireVerified,
    requireAdmin,
  );
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/stats', async (_req, res) => {
    res.json(await admin.stats());
  });

  router.get('/users', async (req, res) => {
    res.json(await admin.users(adminUsersQuerySchema.parse(req.query)));
  });

  router.patch(
    '/users/:id/status',
    createRateLimiter(config.rateLimits.adminStatus),
    validateBody(adminUserStatusSchema),
    async (req, res) => {
      const body = bodyOf(adminUserStatusSchema, req.body);
      const user = await admin.setStatus(authOf(req).user, String(req.params.id), body);
      res.json({ user });
    },
  );

  return router;
}
