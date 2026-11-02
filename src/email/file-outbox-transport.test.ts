import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileOutboxTransport } from './file-outbox-transport.js';
import type { EmailMessage } from './transport.js';

const message = (to: string): EmailMessage => ({
  to,
  subject: 'Verify your email for LinkPocket',
  html: '<p>hi</p>',
  text: 'hi',
  template: 'verify-email',
  idempotencyKey: `key-${to}`,
});

describe('FileOutboxTransport (end-to-end tests only)', () => {
  let dir = '';
  afterEach(() => rm(join(dir, '..'), { recursive: true, force: true }));

  it('writes one JSON file per message, in send order, creating the folder', async () => {
    dir = join(await mkdtemp(join(tmpdir(), 'lp-outbox-')), 'nested');
    const outbox = new FileOutboxTransport(dir);
    await outbox.send(message('a@example.test'));
    await outbox.send(message('b@example.test'));

    const names = (await readdir(dir)).sort();
    expect(names).toHaveLength(2);
    const saved = await Promise.all(
      names.map(
        async (name) => JSON.parse(await readFile(join(dir, name), 'utf8')) as EmailMessage,
      ),
    );
    expect(saved.map((m) => m.to)).toEqual(['a@example.test', 'b@example.test']);
    expect(saved[0]).toEqual(message('a@example.test'));
  });
});
