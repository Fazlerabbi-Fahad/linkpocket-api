import { readFileSync } from 'node:fs';
import type { Logger } from '../lib/logger.js';
import { createHash } from 'node:crypto';

export type BreachResult = 'breached' | 'clean' | 'unavailable';

export interface BreachChecker {
  check(password: string): Promise<BreachResult>;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Have I Been Pwned range API with k-anonymity (clarification 4): only the first five hex
 * characters of the SHA-1 leave the server. Padding hides the response size.
 */
export class HibpBreachChecker implements BreachChecker {
  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = 2500,
  ) {}

  async check(password: string): Promise<BreachResult> {
    const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    try {
      const response = await this.fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'LinkPocket-API' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return 'unavailable';
      const body = await response.text();
      for (const line of body.split('\n')) {
        const [hashSuffix, count] = line.trim().split(':');
        // Padding entries have a count of 0.
        if (hashSuffix === suffix && Number(count) > 0) return 'breached';
      }
      return 'clean';
    } catch {
      return 'unavailable';
    }
  }
}

const COMMON_PASSWORDS_FILE = new URL('../../data/common-passwords.txt', import.meta.url);

/** The bundled list of the 10,000 most common passwords (apps/api/data/README.md). */
export function loadCommonPasswords(file: URL = COMMON_PASSWORDS_FILE): Set<string> {
  const lines = readFileSync(file, 'utf8').split('\n');
  return new Set(lines.map((line) => line.trim().toLowerCase()).filter(Boolean));
}

export type ScreeningResult = { ok: true } | { ok: false; reason: 'common' | 'breached' };

/** FR-A10: common-password and breached-password screening for new passwords. */
export class PasswordScreener {
  constructor(
    private readonly commonPasswords: ReadonlySet<string>,
    private readonly breachChecker: BreachChecker | null,
    private readonly logger: Logger,
  ) {}

  async screen(password: string): Promise<ScreeningResult> {
    if (this.commonPasswords.has(password.toLowerCase())) return { ok: false, reason: 'common' };
    if (!this.breachChecker) return { ok: true };

    const result = await this.breachChecker.check(password);
    if (result === 'breached') return { ok: false, reason: 'breached' };
    if (result === 'unavailable') {
      // Fail open (clarification 4). No password data is logged.
      this.logger.warn({ event: 'breach_check_unavailable' }, 'breached-password check skipped');
    }
    return { ok: true };
  }
}
