import { Resend } from 'resend';
import { EmailSendError, type EmailMessage, type EmailTransport } from './transport.js';

const NOT_RETRYABLE = new Set(['daily_quota_exceeded', 'monthly_quota_exceeded']);

/** Network errors (no status), 429 and 5xx may succeed later; other 4xx never will. */
export function isRetryable(statusCode: number | null, code: string): boolean {
  if (NOT_RETRYABLE.has(code)) return false;
  return statusCode === null || statusCode === 429 || statusCode >= 500;
}

/** Sends through Resend (SRS 2.1). The browser never talks to Resend (SRS 2.4). */
export class ResendTransport implements EmailTransport {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<void> {
    const { error } = await this.client.emails.send(
      {
        from: this.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        tags: [{ name: 'template', value: message.template }],
      },
      { idempotencyKey: message.idempotencyKey },
    );
    if (error) throw new EmailSendError(error.name, isRetryable(error.statusCode, error.name));
  }

  /**
   * Reachability only: sending-only API keys cannot call read endpoints, so any HTTP answer
   * below 500 (including 401) means Resend is up. Sends nothing and uses no quota.
   */
  async check(): Promise<boolean> {
    const res = await this.fetchImpl(RESEND_API_ORIGIN, { method: 'GET' });
    return res.status < 500;
  }
}

export const RESEND_API_ORIGIN = 'https://api.resend.com/';
