import { SignJWT, jwtVerify } from 'jose';
import { deriveKey } from '../lib/crypto.js';

/** Claims carried by the session JWT (ADR-0001): user, session record, session version. */
export interface SessionClaims {
  sub: string;
  jti: string;
  sv: number;
}

const ISSUER = 'linkpocket-api';
const AUDIENCE = 'linkpocket-web';

const toSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** HS256 JWTs signed with a key derived from JWT_SECRET (NFR-S2). */
export class SessionTokens {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    this.key = deriveKey(secret, 'session-jwt');
  }

  sign(claims: SessionClaims, issuedAt: Date, expiresAt: Date): Promise<string> {
    return new SignJWT({ sv: claims.sv })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setJti(claims.jti)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(toSeconds(issuedAt))
      .setExpirationTime(toSeconds(expiresAt))
      .sign(this.key);
  }

  /** Returns the claims of a valid, unexpired token, or null for anything else. */
  async verify(token: string, now: Date): Promise<SessionClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
        currentDate: now,
      });
      const { sub, jti, sv } = payload;
      if (typeof sub !== 'string' || typeof jti !== 'string') return null;
      if (typeof sv !== 'number' || !Number.isInteger(sv)) return null;
      return { sub, jti, sv };
    } catch {
      return null;
    }
  }
}
