import { SignJWT, UnsecuredJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { CsrfTokens } from './csrf.js';
import { SessionTokens } from './session-tokens.js';

const SECRET = 'unit-test-secret-'.padEnd(48, 'z');
const claims = { sub: '65f0c0ffee0000000000abcd', jti: 'session-jti-0123456789', sv: 3 };
const now = new Date('2026-11-01T00:00:00Z');
const later = new Date('2026-11-08T00:00:00Z');

describe('SessionTokens (NFR-S2)', () => {
  const tokens = new SessionTokens(SECRET);

  it('round-trips the claims', async () => {
    const token = await tokens.sign(claims, now, later);
    expect(await tokens.verify(token, now)).toEqual(claims);
  });

  it('rejects expired, tampered, foreign-key and unsigned tokens', async () => {
    const token = await tokens.sign(claims, now, later);
    expect(await tokens.verify(token, later)).toBeNull();

    const [header, payload, signature] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ ...claims, sv: 99 })).toString('base64url');
    expect(await tokens.verify(`${header}.${forgedPayload}.${signature}`, now)).toBeNull();
    expect(await tokens.verify(`${header}.${payload}.`, now)).toBeNull();

    const otherKey = await new SessionTokens('another-secret-'.padEnd(48, 'q')).sign(
      claims,
      now,
      later,
    );
    expect(await tokens.verify(otherKey, now)).toBeNull();

    const unsigned = new UnsecuredJWT({ sv: 3 }).setSubject(claims.sub).setJti(claims.jti).encode();
    expect(await tokens.verify(unsigned, now)).toBeNull();
    expect(await tokens.verify('garbage', now)).toBeNull();
  });

  it('rejects tokens with a raw JWT_SECRET key (keys are derived per purpose)', async () => {
    const raw = await new SignJWT({ sv: 3 })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setJti(claims.jti)
      .setIssuer('linkpocket-api')
      .setAudience('linkpocket-web')
      .setExpirationTime(Math.floor(later.getTime() / 1000))
      .sign(new TextEncoder().encode(SECRET));
    expect(await tokens.verify(raw, now)).toBeNull();
  });
});

describe('CsrfTokens (NFR-S10)', () => {
  const csrf = new CsrfTokens(SECRET);

  it('accepts a token only for the binding it was issued for', () => {
    const token = csrf.issue('jti-a');
    expect(csrf.isValid(token, 'jti-a')).toBe(true);
    expect(csrf.isValid(token, 'jti-b')).toBe(false);
    expect(csrf.isValid(token, 'anon')).toBe(false);
  });

  it('rejects malformed tokens', () => {
    expect(csrf.isValid('', 'anon')).toBe(false);
    expect(csrf.isValid('only-one-part', 'anon')).toBe(false);
    expect(csrf.isValid(`${csrf.issue('anon')}.extra`, 'anon')).toBe(false);
  });

  it('issues a different token each time', () => {
    expect(csrf.issue('anon')).not.toBe(csrf.issue('anon'));
  });
});
