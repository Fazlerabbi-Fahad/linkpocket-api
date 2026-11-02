import {
  changePasswordSchema,
  loginSchema,
  resendVerificationSchema,
  signupSchema,
  verifyEmailSchema,
} from '../shared/index.js';
import { Router, type Request, type Response } from 'express';
import type { AppConfig } from '../config.js';
import { AppError } from '../lib/app-error.js';
import type { Clock } from '../lib/clock.js';
import { authOf, requireUser, requireVerified } from '../middleware/authenticate.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { bodyOf, validateBody } from '../middleware/validate.js';
import { toCurrentUser, type AuthService } from './auth-service.js';
import { SESSION_COOKIE, clearSessionCookie, readCookie, setSessionCookie } from './cookies.js';
import { csrfBinding, rotateCsrf, type CsrfTokens } from './csrf.js';
import type { EmailVerificationService } from './email-verification.js';
import type { IssuedSession, SessionService } from './session-service.js';
import type { SessionTokens } from './session-tokens.js';

export interface AuthRouterDeps {
  config: AppConfig;
  clock: Clock;
  auth: AuthService;
  sessions: SessionService;
  tokens: SessionTokens;
  csrf: CsrfTokens;
  verification: EmailVerificationService;
}

/** NFR-S15: one fixed response for every successful signup request. */
export const SIGNUP_RESPONSE = {
  message: 'Check your email for a link to verify your account.',
} as const;

/** NFR-S15, AC-14: one fixed response for every accepted resend request. */
export const RESEND_RESPONSE = {
  message: 'If that address is waiting for verification, we sent a new link.',
} as const;

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const { config, clock, auth, sessions, tokens, csrf, verification } = deps;
  const router = Router();
  const authenticated = requireUser(sessions, clock);

  /** Sets the session cookie and a CSRF token bound to the new session. */
  function startSession(res: Response, issued: IssuedSession): string {
    setSessionCookie(res, issued.token, issued.session.expiresAt, clock.now());
    return rotateCsrf(res, csrf, issued.session.jti);
  }

  /** The web app calls this once to get a CSRF token before its first POST (NFR-S10). */
  router.get('/csrf', async (req: Request, res: Response) => {
    const binding = await csrfBinding(readCookie(req, SESSION_COOKIE), tokens, clock);
    res.set('Cache-Control', 'no-store');
    res.json({ csrfToken: rotateCsrf(res, csrf, binding) });
  });

  router.post(
    '/signup',
    createRateLimiter(config.rateLimits.signup),
    validateBody(signupSchema),
    async (req, res) => {
      await auth.signup(bodyOf(signupSchema, req.body));
      res.status(202).json(SIGNUP_RESPONSE);
    },
  );

  router.post(
    '/login',
    createRateLimiter(config.rateLimits.login),
    validateBody(loginSchema),
    async (req, res) => {
      const issued = await auth.login(bodyOf(loginSchema, req.body), req.get('user-agent'));
      const csrfToken = startSession(res, issued);
      res.set('Cache-Control', 'no-store');
      res.json({ user: toCurrentUser(issued.user), csrfToken });
    },
  );

  /**
   * FR-A5: verifies the account and starts a session. A malformed token gets the same error
   * as a used or expired one, so the web app shows one "invalid link, resend?" screen (AC-3).
   */
  router.post(
    '/verify-email',
    createRateLimiter(config.rateLimits.verifyEmail),
    async (req, res) => {
      const parsed = verifyEmailSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError('VERIFICATION_LINK_INVALID');
      const user = await verification.verify(parsed.data.token);
      const issued = await sessions.create(user, req.get('user-agent'));
      const csrfToken = startSession(res, issued);
      res.set('Cache-Control', 'no-store');
      res.json({ user: toCurrentUser(user), csrfToken });
    },
  );

  /** FR-A4, AC-4, AC-14: per-IP limit here, per-address limit in the service. */
  router.post(
    '/resend-verification',
    createRateLimiter(config.rateLimits.resendVerification),
    validateBody(resendVerificationSchema),
    async (req, res) => {
      const { email } = bodyOf(resendVerificationSchema, req.body);
      if ((await verification.resend(email)) === 'limited') throw new AppError('RATE_LIMITED');
      res.status(202).json(RESEND_RESPONSE);
    },
  );

  /** FR-A6: revokes the server-side record and clears the cookie. Idempotent. */
  router.post('/logout', async (req, res) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) await sessions.revoke(token);
    clearSessionCookie(res);
    rotateCsrf(res, csrf, null);
    res.status(204).end();
  });

  router.get('/me', authenticated, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ user: toCurrentUser(authOf(req).user) });
  });

  router.post(
    '/change-password',
    createRateLimiter(config.rateLimits.changePassword),
    authenticated,
    requireVerified,
    validateBody(changePasswordSchema),
    async (req, res) => {
      const issued = await auth.changePassword(
        authOf(req).user,
        bodyOf(changePasswordSchema, req.body),
        req.get('user-agent'),
      );
      const csrfToken = startSession(res, issued);
      res.set('Cache-Control', 'no-store');
      res.json({ user: toCurrentUser(issued.user), csrfToken });
    },
  );

  return router;
}
