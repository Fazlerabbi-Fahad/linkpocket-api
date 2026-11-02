import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureLogger } from '../../test/capture-logger.js';
import { FakeEmailTransport } from '../../test/harness.js';
import { EMAIL_RETRY_POLICY, EmailDispatcher } from './dispatcher.js';
import { LogEmailTransport } from './log-transport.js';
import { ResendTransport, isRetryable } from './resend-transport.js';
import { renderVerifyEmail } from './templates/verify-email.js';
import { EmailSendError, type EmailMessage } from './transport.js';
import { VerificationMailer } from './verification-mailer.js';

const ADDRESS = 'person@example.com';

const message = (): EmailMessage => ({
  to: ADDRESS,
  subject: 'Subject',
  html: '<p>Hi</p>',
  text: 'Hi',
  template: 'verify-email',
  idempotencyKey: 'verify-email/abc',
});

function setup() {
  const transport = new FakeEmailTransport();
  const capture = captureLogger();
  const delays: number[] = [];
  const dispatcher = new EmailDispatcher(transport, capture.logger, EMAIL_RETRY_POLICY, (ms) => {
    delays.push(ms);
    return Promise.resolve();
  });
  return { transport, capture, delays, dispatcher };
}

describe('EmailDispatcher (NFR-A4)', () => {
  it('sends once when the provider accepts', async () => {
    const { transport, dispatcher, delays } = setup();
    dispatcher.dispatch('verify-email', () => Promise.resolve(message()));
    await dispatcher.idle();
    expect(transport.sent).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it('gives up after 3 attempts with 1 s and 2 s backoff, logging without the address', async () => {
    const { transport, dispatcher, delays, capture } = setup();
    transport.failures = [new Error('a'), new Error('b'), new Error('c'), new Error('d')];
    dispatcher.dispatch('verify-email', () => Promise.resolve(message()));
    await dispatcher.idle();

    expect(transport.attempts).toBe(3);
    expect(transport.sent).toHaveLength(0);
    expect(delays).toEqual([1000, 2000]);
    expect(capture.lines.at(-1)).toMatchObject({
      level: 50,
      event: 'email_send_failed',
      template: 'verify-email',
      attempts: 3,
      reason: 'unknown',
    });
    expect(capture.lines.filter((line) => line.event === 'email_send_retry')).toHaveLength(2);
    expect(capture.raw.join('')).not.toContain(ADDRESS);
  });

  it('does not retry errors that cannot succeed', async () => {
    const { transport, dispatcher, capture } = setup();
    transport.failures = [new EmailSendError('validation_error', false)];
    dispatcher.dispatch('verify-email', () => Promise.resolve(message()));
    await dispatcher.idle();
    expect(transport.attempts).toBe(1);
    expect(capture.lines.at(-1)).toMatchObject({ attempts: 1, reason: 'validation_error' });
  });

  it('retries provider errors marked retryable', async () => {
    const { transport, dispatcher } = setup();
    transport.failures = [new EmailSendError('rate_limit_exceeded', true)];
    dispatcher.dispatch('verify-email', () => Promise.resolve(message()));
    await dispatcher.idle();
    expect(transport.attempts).toBe(2);
    expect(transport.sent).toHaveLength(1);
  });

  it('logs a render failure and never calls the provider', async () => {
    const { transport, dispatcher, capture } = setup();
    dispatcher.dispatch('verify-email', () => Promise.reject(new Error('render')));
    await dispatcher.idle();
    expect(transport.attempts).toBe(0);
    expect(capture.lines.at(-1)).toMatchObject({ event: 'email_send_failed', reason: 'render' });
  });

  it('waits with real timers by default', async () => {
    const transport = new FakeEmailTransport();
    transport.failures = [new Error('once')];
    const dispatcher = new EmailDispatcher(transport, captureLogger().logger, {
      attempts: 2,
      baseDelayMs: 1,
    });
    dispatcher.dispatch('verify-email', () => Promise.resolve(message()));
    await dispatcher.idle();
    expect(transport.sent).toHaveLength(1);
  });
});

describe('ResendTransport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('posts the message with an idempotency key', async () => {
    const fetchMock = stubFetch(200, { id: 'email-id' });
    // Placeholder key; the request never leaves the process.
    await new ResendTransport('re_test_placeholder', 'LinkPocket <no-reply@example.com>').send(
      message(),
    );

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.resend.com/emails');
    const headers = new Headers(init?.headers);
    expect(headers.get('idempotency-key')).toBe('verify-email/abc');
    expect(JSON.parse(typeof init?.body === 'string' ? init.body : 'null')).toMatchObject({
      from: 'LinkPocket <no-reply@example.com>',
      to: ADDRESS,
      subject: 'Subject',
      text: 'Hi',
      tags: [{ name: 'template', value: 'verify-email' }],
    });
  });

  it('turns provider errors into EmailSendError', async () => {
    stubFetch(422, { name: 'validation_error', message: 'bad', statusCode: 422 });
    const send = new ResendTransport('re_test_placeholder', 'a@example.com').send(message());
    await expect(send).rejects.toMatchObject({ code: 'validation_error', retryable: false });
  });

  it.each([
    [null, 'application_error', true],
    [429, 'rate_limit_exceeded', true],
    [500, 'internal_server_error', true],
    [429, 'daily_quota_exceeded', false],
    [403, 'invalid_from_address', false],
  ])('status %s / %s retryable: %s', (status, code, expected) => {
    expect(isRetryable(status, code)).toBe(expected);
  });
});

describe('LogEmailTransport (development only)', () => {
  it('writes the plain-text email to the log', async () => {
    const capture = captureLogger();
    await new LogEmailTransport(capture.logger).send(message());
    expect(capture.lines[0]).toMatchObject({
      event: 'dev_email',
      template: 'verify-email',
      msg: 'Hi',
    });
  });
});

describe('verification email template (FR-A2)', () => {
  const verifyUrl = 'https://app.example.com/verify-email#token=abc_DEF-123';

  it('renders HTML and plain text with the link, expiry and ignore notice', async () => {
    const { subject, html, text } = await renderVerifyEmail({
      verifyUrl,
      expiresInHours: 24,
      deleteAfterDays: 7,
    });
    expect(subject).toBe('Verify your email for LinkPocket');
    expect(html).toMatch(/^<!DOCTYPE html/);
    expect(html).toContain('lang="en"');
    expect(html).toContain(`href="${verifyUrl}"`);
    expect(html).not.toMatch(/Inter|Roboto|Arial/);
    for (const part of [verifyUrl, '24 hours', '7 days', 'Verify email']) {
      expect(text).toContain(part);
    }
    expect(text).not.toContain('<');
  });

  it('escapes the link like any other text', async () => {
    const { html } = await renderVerifyEmail({
      verifyUrl: 'https://x.test/"><script>alert(1)</script>',
      expiresInHours: 24,
      deleteAfterDays: 7,
    });
    expect(html).not.toContain('<script>');
  });

  it('mailer links to the web app with the token in the fragment', async () => {
    const transport = new FakeEmailTransport();
    const dispatcher = new EmailDispatcher(transport, captureLogger().logger);
    const mailer = new VerificationMailer(dispatcher, 'https://app.example.com');
    mailer.send(ADDRESS, 'T'.repeat(43));
    await dispatcher.idle();
    expect(transport.sent[0]?.text).toContain(
      `https://app.example.com/verify-email#token=${'T'.repeat(43)}`,
    );
    expect(transport.sent[0]?.idempotencyKey).not.toContain('T'.repeat(43));
  });
});
