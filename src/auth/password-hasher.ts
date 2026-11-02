import { hash, verify } from '@node-rs/argon2';
import type { AppConfig } from '../config.js';

/**
 * NFR-S1: Argon2id (ADR-0004). Unlike bcrypt it has no 72-byte input limit, so all 128
 * allowed characters (FR-A10) count.
 */
export class PasswordHasher {
  private dummyHash: Promise<string> | null = null;

  constructor(private readonly params: AppConfig['passwordHash']) {}

  hash(password: string): Promise<string> {
    // @node-rs/argon2 defaults to Argon2id (asserted in password-hasher.test.ts).
    return hash(password, this.params);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /**
   * Spends the same time as a real check when no account exists, so login timing does not
   * reveal which emails are registered (NFR-S15 spirit for login).
   */
  async verifyAgainstDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash('linkpocket-dummy-password-for-timing');
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
