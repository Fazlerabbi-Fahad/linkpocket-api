import { describe, expect, it } from 'vitest';
import { ARGON2_PRODUCTION } from '../config.js';
import { PasswordHasher } from './password-hasher.js';

const fast = new PasswordHasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 });

describe('PasswordHasher (NFR-S1)', () => {
  it('produces salted Argon2id hashes', async () => {
    const [a, b] = await Promise.all([fast.hash('same-password'), fast.hash('same-password')]);
    expect(a).toMatch(/^\$argon2id\$v=19\$/);
    expect(a).not.toBe(b);
  });

  it('uses the OWASP minimum parameters outside tests', async () => {
    const hash = await new PasswordHasher(ARGON2_PRODUCTION).hash('x');
    expect(hash).toContain('$m=19456,t=2,p=1$');
  });

  it('verifies the right password and rejects others', async () => {
    const hash = await fast.hash('right-password');
    expect(await fast.verify(hash, 'right-password')).toBe(true);
    expect(await fast.verify(hash, 'wrong-password')).toBe(false);
    expect(await fast.verify('not-a-hash', 'right-password')).toBe(false);
  });

  it('uses every character of a 128-character password (no bcrypt-style truncation)', async () => {
    const long = 'a'.repeat(127);
    const hash = await fast.hash(`${long}b`);
    expect(await fast.verify(hash, `${long}c`)).toBe(false);
  });

  it('dummy verification always fails', async () => {
    expect(await fast.verifyAgainstDummy('anything')).toBe(false);
  });
});
