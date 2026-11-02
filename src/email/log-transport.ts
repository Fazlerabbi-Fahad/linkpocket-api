import type { Logger } from '../lib/logger.js';
import type { EmailMessage, EmailTransport } from './transport.js';

/**
 * Development only, when RESEND_API_KEY is not set: writes the plain-text email (including
 * the verification link) to the local log so sign-up can be finished without a provider.
 * Production refuses to start without Resend settings (config.ts), so this never runs there.
 */
export class LogEmailTransport implements EmailTransport {
  constructor(private readonly logger: Logger) {}

  send(message: EmailMessage): Promise<void> {
    this.logger.info(
      { event: 'dev_email', template: message.template, subject: message.subject },
      message.text,
    );
    return Promise.resolve();
  }
}
