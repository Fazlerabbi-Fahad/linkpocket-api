/** A rendered transactional email (FR-A2). Only ever sent to the account's own address. */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Template name, for logs and provider tags. Never log `to` (NFR-B6). */
  template: string;
  /** Lets the provider drop duplicates when a retry follows a send that actually succeeded. */
  idempotencyKey: string;
}

export interface EmailTransport {
  /** Resolves when the provider accepted the message. Throws on failure. */
  send(message: EmailMessage): Promise<void>;
  /** NFR-A2 readiness: true when the provider is reachable. Local transports omit it. */
  check?(): Promise<boolean>;
}

/** A provider failure. `retryable` is false when sending again cannot succeed. */
export class EmailSendError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(`Email provider error: ${code}`);
    this.name = 'EmailSendError';
  }
}
