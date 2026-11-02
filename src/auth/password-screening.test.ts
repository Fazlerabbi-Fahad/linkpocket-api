import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../lib/logger.js';
import { HibpBreachChecker, PasswordScreener, loadCommonPasswords } from './password-screening.js';

const PASSWORD = 'correct horse battery staple';
const SHA1 = createHash('sha1').update(PASSWORD).digest('hex').toUpperCase();

function fakeFetch(body: string, status = 200) {
  return vi.fn((_url: string, _init: RequestInit) =>
    Promise.resolve(new Response(body, { status })),
  );
}

describe('HibpBreachChecker (FR-A10, clarification 4)', () => {
  it('sends only the first 5 SHA-1 characters, with padding (k-anonymity)', async () => {
    const fetchImpl = fakeFetch('');
    await new HibpBreachChecker(fetchImpl).check(PASSWORD);

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${SHA1.slice(0, 5)}`);
    expect(url).not.toContain(SHA1.slice(5));
    expect(url).not.toContain(PASSWORD);
    expect(new Headers(init?.headers).get('Add-Padding')).toBe('true');
  });

  it('reports a breach when the suffix is listed with a positive count', async () => {
    const body = `0000000000000000000000000000000000A:3\r\n${SHA1.slice(5)}:42\r\n`;
    expect(await new HibpBreachChecker(fakeFetch(body)).check(PASSWORD)).toBe('breached');
  });

  it('ignores padding entries with a zero count', async () => {
    expect(await new HibpBreachChecker(fakeFetch(`${SHA1.slice(5)}:0\n`)).check(PASSWORD)).toBe(
      'clean',
    );
  });

  it('is unavailable on HTTP errors, network errors and timeouts', async () => {
    expect(await new HibpBreachChecker(fakeFetch('', 503)).check(PASSWORD)).toBe('unavailable');
    const failing = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')));
    expect(await new HibpBreachChecker(failing).check(PASSWORD)).toBe('unavailable');
    const hanging = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    expect(await new HibpBreachChecker(hanging, 20).check(PASSWORD)).toBe('unavailable');
  });
});

describe('PasswordScreener', () => {
  const logger = () =>
    ({ warn: vi.fn() }) as unknown as Logger & { warn: ReturnType<typeof vi.fn> };

  it('rejects common passwords case-insensitively, before any network call', async () => {
    const checker = { check: vi.fn() };
    const screener = new PasswordScreener(new Set(['letmein123']), checker, logger());
    expect(await screener.screen('LetMeIn123')).toEqual({ ok: false, reason: 'common' });
    expect(checker.check).not.toHaveBeenCalled();
  });

  it('rejects breached passwords', async () => {
    const screener = new PasswordScreener(
      new Set(),
      { check: () => Promise.resolve('breached') },
      logger(),
    );
    expect(await screener.screen(PASSWORD)).toEqual({ ok: false, reason: 'breached' });
  });

  it('fails open and logs a warning without password data when HIBP is down', async () => {
    const log = logger();
    const screener = new PasswordScreener(
      new Set(),
      { check: () => Promise.resolve('unavailable') },
      log,
    );
    expect(await screener.screen(PASSWORD)).toEqual({ ok: true });
    expect(log.warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(PASSWORD);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(SHA1.slice(0, 5));
  });

  it('works without a breach checker', async () => {
    expect(await new PasswordScreener(new Set(), null, logger()).screen(PASSWORD)).toEqual({
      ok: true,
    });
  });
});

describe('loadCommonPasswords', () => {
  it('loads the bundled list of 10,000 common passwords', () => {
    const list = loadCommonPasswords();
    expect(list.size).toBeGreaterThanOrEqual(9_900);
    expect(list.has('password')).toBe(true);
    expect(list.has('qwertyuiop')).toBe(true);
    expect(list.has('')).toBe(false);
  });
});
