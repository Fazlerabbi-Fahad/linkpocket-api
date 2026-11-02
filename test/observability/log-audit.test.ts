import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { ResourceService } from '../../src/resources/resource-service.js';
import { captureLogger } from '../capture-logger.js';
import {
  OTHER_STRONG_PASSWORD,
  STRONG_PASSWORD,
  TestClient,
  createHarness,
  uniqueEmail,
} from '../harness.js';
import { useMigratedDb } from '../migrated-db.js';

/**
 * AC-21, NFR-B6: drive every kind of request through the real logger (debug level, production
 * redaction and serializers), collecting each secret the flow handles, then search the raw log
 * output for all of them.
 */
describe('AC-21: log audit', () => {
  useMigratedDb();
  afterEach(() => vi.restoreAllMocks());

  it('logs no passwords, tokens, cookies, resource URLs, search terms or emails', async () => {
    const capture = captureLogger();
    const harness = createHarness({}, { logger: capture.logger });
    const { app, mail } = harness;
    const secrets = new Set<string>();
    const collectCookies = (client: TestClient) => {
      for (const value of client.cookies.values()) secrets.add(decodeURIComponent(value));
    };

    const email = uniqueEmail('logaudit');
    const resourceUrl = 'https://zq-private-host.example/very/secret/path?token=zqurltoken';
    const searchTerm = 'zqsearchterm';
    secrets.add(email).add(STRONG_PASSWORD).add(OTHER_STRONG_PASSWORD);
    secrets.add('zq-private-host').add('zqurltoken').add(searchTerm);

    const client = await new TestClient(app).init();
    expect((await client.signup(email)).status).toBe(202);
    await harness.emailsSettled();
    const token = mail.latestToken(email);
    secrets.add(token);
    expect((await client.verifyEmail(token)).status).toBe(200);
    collectCookies(client);
    expect((await client.login(email, 'wrong-password-zq')).status).toBe(401);
    secrets.add('wrong-password-zq');
    expect((await client.login(email)).status).toBe(200);
    collectCookies(client);

    const created = await client.send('post', '/api/v1/resources', {
      url: resourceUrl,
      title: 'zqtitle',
      note: 'zqnote',
      tags: ['zqtag'],
    });
    expect(created.status).toBe(201);
    const id = (created.body as unknown as { resource: { id: string } }).resource.id;
    expect((await client.send('get', `/api/v1/resources?q=${searchTerm}&tag=zqtag`)).status).toBe(
      200,
    );
    expect((await client.send('patch', `/api/v1/resources/${id}`, { isPinned: true })).status).toBe(
      200,
    );
    expect((await client.send('get', `/api/v1/resources/${id}`)).status).toBe(200);
    expect(
      (await client.send('post', '/api/v1/resources', { url: 'javascript:alert(1)' })).status,
    ).toBe(400);

    // An unexpected error whose message quotes user data still logs only its class and stack.
    vi.spyOn(ResourceService.prototype, 'list').mockRejectedValueOnce(
      new Error(`boom for ${email} at ${resourceUrl}`),
    );
    expect((await client.send('get', '/api/v1/resources')).status).toBe(500);

    expect((await client.changePassword(STRONG_PASSWORD, OTHER_STRONG_PASSWORD)).status).toBe(200);
    collectCookies(client);
    expect((await client.send('get', '/api/v1/account/export')).status).toBe(200);
    expect(
      (await client.send('delete', '/api/v1/account', { password: OTHER_STRONG_PASSWORD })).status,
    ).toBe(204);
    await harness.emailsSettled();

    const output = capture.raw.join('');
    expect(capture.lines.length).toBeGreaterThan(10);
    expect(secrets.size).toBeGreaterThan(10);
    for (const secret of secrets) {
      expect(output, `log contains ${secret.slice(0, 6)}…`).not.toContain(secret);
    }
    for (const fragment of ['zqtitle', 'zqnote', SESSION_COOKIE, 'cookie', 'authorization']) {
      expect(output.toLowerCase()).not.toContain(fragment.toLowerCase());
    }

    // The failure is still traceable: class, stack frames, request ID and user ID.
    const failure = capture.lines.find((line) => line.msg === 'unhandled error');
    expect(failure).toMatchObject({ err: { type: 'Error' } });
    expect(typeof failure?.requestId).toBe('string');
    expect(String((failure?.err as { stack: string }).stack)).toMatch(/^\s+at /);
  });

  it('redacts secret fields even when code logs them by mistake', () => {
    const capture = captureLogger();
    capture.logger.info(
      {
        password: 'p1zq',
        user: { passwordHash: 'h1zq', token: 't1zq' },
        body: { currentPassword: 'c1zq', newPassword: 'n1zq' },
        req: { headers: { cookie: 'k1zq', authorization: 'a1zq', 'x-csrf-token': 'x1zq' } },
        res: { headers: { 'set-cookie': 's1zq' } },
      },
      'oops',
    );
    expect(capture.raw.join('')).not.toMatch(/[a-z]1zq/);
    expect(capture.lines[0]).toMatchObject({ password: '[redacted]' });
  });
});
