import type { RequestHandler } from 'express';
import { AppError } from '../lib/app-error.js';
import type { Clock } from '../lib/clock.js';
import { deriveKey, hmacBase64Url, randomToken, safeEqual } from '../lib/crypto.js';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, readCookie, setCsrfCookie } from './cookies.js';
import type { SessionTokens } from './session-tokens.js';

const ANONYMOUS = 'anon';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Signed double-submit CSRF tokens (NFR-S10, OWASP CSRF cheat sheet). A token is
 * `nonce.HMAC(nonce, binding)`, where the binding is the session's jti (or "anon" before
 * login). The header must equal the cookie and carry a valid MAC for the current session, so
 * a token planted by a sibling subdomain or left from another session is rejected.
 */
export class CsrfTokens {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = deriveKey(secret, 'csrf');
  }

  issue(binding: string): string {
    const nonce = randomToken(18);
    return `${nonce}.${hmacBase64Url(this.key, `${binding}.${nonce}`)}`;
  }

  isValid(token: string, binding: string): boolean {
    const [nonce, mac, extra] = token.split('.');
    if (!nonce || !mac || extra !== undefined) return false;
    return safeEqual(mac, hmacBase64Url(this.key, `${binding}.${nonce}`));
  }
}

/** The session jti if the cookie holds a validly signed, unexpired JWT; otherwise "anon". */
export async function csrfBinding(
  token: string | undefined,
  tokens: SessionTokens,
  clock: Clock,
): Promise<string> {
  if (!token) return ANONYMOUS;
  const claims = await tokens.verify(token, clock.now());
  return claims?.jti ?? ANONYMOUS;
}

export function csrfProtection(
  csrf: CsrfTokens,
  tokens: SessionTokens,
  clock: Clock,
): RequestHandler {
  return async (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const header = req.get(CSRF_HEADER);
    const cookie = readCookie(req, CSRF_COOKIE);
    const binding = await csrfBinding(readCookie(req, SESSION_COOKIE), tokens, clock);
    if (!header || !cookie || !safeEqual(header, cookie) || !csrf.isValid(header, binding)) {
      next(new AppError('CSRF_INVALID'));
      return;
    }
    next();
  };
}

/** Issues a fresh token for `binding`, sets the cookie, and returns the token. */
export function rotateCsrf(
  res: Parameters<typeof setCsrfCookie>[0],
  csrf: CsrfTokens,
  binding: string | null,
): string {
  const token = csrf.issue(binding ?? ANONYMOUS);
  setCsrfCookie(res, token);
  return token;
}
