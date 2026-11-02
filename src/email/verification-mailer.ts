import { TIMINGS, VERIFY_EMAIL_PATH } from '../shared/index.js';
import { sha256Hex } from '../lib/crypto.js';
import type { EmailDispatcher } from './dispatcher.js';
import { renderVerifyEmail } from './templates/verify-email.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Builds and queues the FR-A2 verification email. */
export class VerificationMailer {
  constructor(
    private readonly dispatcher: EmailDispatcher,
    private readonly webOrigin: string,
  ) {}

  /** The token goes in the fragment, so it never reaches a server log (VERIFY_EMAIL_PATH). */
  verifyUrl(token: string): string {
    return `${this.webOrigin}${VERIFY_EMAIL_PATH}#token=${token}`;
  }

  send(to: string, token: string): void {
    this.dispatcher.dispatch('verify-email', async () => ({
      to,
      template: 'verify-email',
      // One key per token: a retry after a lost response is not delivered twice.
      idempotencyKey: `verify-email/${sha256Hex(token)}`,
      ...(await renderVerifyEmail({
        verifyUrl: this.verifyUrl(token),
        expiresInHours: TIMINGS.verificationLinkTtlMs / HOUR,
        deleteAfterDays: TIMINGS.unverifiedAccountMaxAgeMs / DAY,
      })),
    }));
  }
}
