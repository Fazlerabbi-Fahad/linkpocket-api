import {
  createResourceSchema,
  listResourcesQuerySchema,
  updateResourceSchema,
} from '../shared/index.js';
import { Router, type RequestHandler } from 'express';
import { ZodError, type z } from 'zod';
import { AppError } from '../lib/app-error.js';
import { authOf, requireVerified } from '../middleware/authenticate.js';
import type { ResourceService } from './resource-service.js';

/**
 * Parses a body; URL problems get the INVALID_URL code (FR-U3, AC-9) so the web app can
 * show the inline error, other problems are VALIDATION_FAILED.
 */
function parseResourceBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  try {
    return schema.parse(body ?? {});
  } catch (error) {
    if (error instanceof ZodError && error.issues.some((issue) => issue.path[0] === 'url')) {
      throw new AppError(
        'INVALID_URL',
        error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      );
    }
    throw error;
  }
}

/** SRS 6 resource endpoints. All require a verified user (FR-A3, AC-2). */
export function createResourceRouter(
  authenticated: RequestHandler,
  resources: ResourceService,
): Router {
  const router = Router();
  router.use(authenticated, requireVerified);

  router.get('/', async (req, res) => {
    const query = listResourcesQuerySchema.parse(req.query);
    res.set('Cache-Control', 'no-store');
    res.json(await resources.list(authOf(req).user._id, query));
  });

  router.post('/', async (req, res) => {
    const body = parseResourceBody(createResourceSchema, req.body);
    res.status(201).json(await resources.create(authOf(req).user._id, body));
  });

  router.get('/:id', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ resource: await resources.get(authOf(req).user._id, req.params.id) });
  });

  router.patch('/:id', async (req, res) => {
    const body = parseResourceBody(updateResourceSchema, req.body);
    res.json({ resource: await resources.update(authOf(req).user._id, req.params.id, body) });
  });

  router.delete('/:id', async (req, res) => {
    await resources.delete(authOf(req).user._id, req.params.id);
    res.status(204).end();
  });

  return router;
}
