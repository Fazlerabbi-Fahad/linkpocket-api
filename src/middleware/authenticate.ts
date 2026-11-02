import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  readCookie,
  setSessionCookie,
} from '../auth/cookies.js';
import type { SessionRecord, SessionService, SessionUser } from '../auth/session-service.js';
import { AppError } from '../lib/app-error.js';
import type { Clock } from '../lib/clock.js';

export interface AuthContext {
  user: SessionUser;
  session: SessionRecord;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's own extension point for Request
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/** The authenticated context; only call after requireUser has run. */
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw new AppError('UNAUTHENTICATED');
  return req.auth;
}

/** Any signed-in user, verified or not (for /auth/me and logout). FR-A11, NFR-S3. */
export function requireUser(sessions: SessionService, clock: Clock): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) {
      next(new AppError('UNAUTHENTICATED'));
      return;
    }
    const result = await sessions.authenticate(token);
    if (result.status !== 'ok') {
      clearSessionCookie(res);
      next(new AppError(result.status === 'disabled' ? 'ACCOUNT_DISABLED' : 'SESSION_EXPIRED'));
      return;
    }
    if (result.refreshedToken) {
      setSessionCookie(res, result.refreshedToken, result.session.expiresAt, clock.now());
    }
    req.auth = { user: result.user, session: result.session };
    next();
  };
}

/**
 * FR-AD1, FR-AD2, NFR-S5, AC-10: the role comes from the user record read on this request
 * (requireUser), never from the token or the client.
 */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (authOf(req).user.role !== 'admin') {
    next(new AppError('FORBIDDEN'));
    return;
  }
  next();
};

/** FR-A3, AC-2: resource and account endpoints require a verified email. */
export const requireVerified: RequestHandler = (req, _res, next) => {
  if (authOf(req).user.emailVerifiedAt === null) {
    next(new AppError('EMAIL_NOT_VERIFIED'));
    return;
  }
  next();
};
