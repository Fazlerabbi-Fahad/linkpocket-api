import { setTimeout as delay } from 'node:timers/promises';
import type { Logger } from '../lib/logger.js';
import { EmailSendError, type EmailMessage, type EmailTransport } from './transport.js';

/** NFR-A4: up to 3 attempts with exponential backoff (1 s, then 2 s), then log the failure. */
export interface RetryPolicy {
  attempts: number;
  baseDelayMs: number;
}

export const EMAIL_RETRY_POLICY: RetryPolicy = { attempts: 3, baseDelayMs: 1000 };

export type Sleep = (ms: number) => Promise<unknown>;

/**
 * Sends email in the background, so a request never waits on the provider and responses do
 * not differ in timing between new and existing addresses (NFR-S15). Call `idle()` before
 * shutting down (and in tests) to wait for queued sends.
 */
export class EmailDispatcher {
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly transport: EmailTransport,
    private readonly logger: Logger,
    private readonly policy: RetryPolicy = EMAIL_RETRY_POLICY,
    private readonly sleep: Sleep = delay,
  ) {}

  /** Queues a message. `build` renders it off the request path. Never throws. */
  dispatch(template: string, build: () => Promise<EmailMessage>): void {
    const task = this.deliver(template, build).finally(() => this.inFlight.delete(task));
    this.inFlight.add(task);
  }

  /** NFR-A2: whether the provider is reachable (always true for local transports). */
  checkProvider(): Promise<boolean> {
    return this.transport.check ? this.transport.check() : Promise.resolve(true);
  }

  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  private async deliver(template: string, build: () => Promise<EmailMessage>): Promise<void> {
    let message: EmailMessage;
    try {
      message = await build();
    } catch {
      this.logger.error({ event: 'email_send_failed', template, attempts: 0, reason: 'render' });
      return;
    }

    for (let attempt = 1; attempt <= this.policy.attempts; attempt += 1) {
      try {
        await this.transport.send(message);
        return;
      } catch (error) {
        // Unknown errors (network, SDK) are worth retrying; known provider errors say so.
        const retryable = !(error instanceof EmailSendError) || error.retryable;
        const reason = error instanceof EmailSendError ? error.code : 'unknown';
        if (!retryable || attempt === this.policy.attempts) {
          // NFR-A4, NFR-O3: the address is never logged (NFR-B6).
          this.logger.error({ event: 'email_send_failed', template, attempts: attempt, reason });
          return;
        }
        this.logger.warn({ event: 'email_send_retry', template, attempt, reason });
        await this.sleep(this.policy.baseDelayMs * 2 ** (attempt - 1));
      }
    }
  }
}
