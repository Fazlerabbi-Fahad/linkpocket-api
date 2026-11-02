import { TIMINGS } from '../shared/index.js';
import type { CookieOptions, Request, Response } from 'express';

/**
 * `__Host-` cookies must be Secure, Path=/ and have no Domain, so they stay on the web origin
 * that proxies the API (ADR-0002). Browsers accept Secure cookies on http://localhost.
 */
export const SESSION_COOKIE = '__Host-lp_session';
export const CSRF_COOKIE = '__Host-lp_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const base: CookieOptions = { secure: true, sameSite: 'lax', path: '/' };

/** NFR-S2: httpOnly, Secure, SameSite=Lax. Lifetime follows the session record. */
export function setSessionCookie(res: Response, token: string, expiresAt: Date, now: Date): void {
  res.cookie(SESSION_COOKIE, token, {
    ...base,
    httpOnly: true,
    maxAge: Math.max(0, expiresAt.getTime() - now.getTime()),
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { ...base, httpOnly: true });
}

/** NFR-S10: readable by the web app so it can echo the value in the X-CSRF-Token header. */
export function setCsrfCookie(res: Response, token: string): void {
  res.cookie(CSRF_COOKIE, token, {
    ...base,
    httpOnly: false,
    maxAge: TIMINGS.sessionIdleTimeoutMs,
  });
}

export function readCookie(req: Request, name: string): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}
