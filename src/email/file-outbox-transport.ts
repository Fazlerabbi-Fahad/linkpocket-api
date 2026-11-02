import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EmailMessage, EmailTransport } from './transport.js';

/**
 * End-to-end tests only (EMAIL_OUTBOX_DIR): writes each message as a JSON file so Playwright
 * can follow the verification link (AC-1). Refused in production (config.ts).
 */
export class FileOutboxTransport implements EmailTransport {
  private count = 0;

  constructor(private readonly dir: string) {}

  async send(message: EmailMessage): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    this.count += 1;
    const name = `${Date.now()}-${String(this.count).padStart(4, '0')}.json`;
    await writeFile(join(this.dir, name), JSON.stringify(message), 'utf8');
  }
}
