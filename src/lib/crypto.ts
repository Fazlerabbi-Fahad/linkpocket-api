import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL-safe random token (NFR-S9: at least 32 bytes). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hmacBase64Url(key: Buffer, message: string): string {
  return createHmac('sha256', key).update(message, 'utf8').digest('base64url');
}

/** Constant-time string comparison (NFR-S9). Unequal lengths return false without leaking. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/** Derives independent keys (JWT signing, CSRF) from the one configured secret. */
export function deriveKey(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'linkpocket', purpose, 32));
}
