import supertest from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ErrorContext, ErrorReporter } from '../../src/lib/error-reporter.js';
import { ResourceService } from '../../src/resources/resource-service.js';
import { captureLogger } from '../capture-logger.js';
import { createHarness, loggedInClient, uniqueEmail } from '../harness.js';
import { useMigratedDb } from '../migrated-db.js';

class FakeReporter implements ErrorReporter {
  readonly captured: { error: unknown; context: ErrorContext }[] = [];
  capture(error: unknown, context: ErrorContext): void {
    this.captured.push({ error, context });
  }
  flush(): Promise<void> {
    return Promise.resolve();
  }
}

function completions(lines: Record<string, unknown>[]) {
  return lines.filter((line) => line.msg === 'request completed' || line.msg === 'request errored');
}

describe('NFR-O1: request logs', () => {
  useMigratedDb();
  afterEach(() => vi.restoreAllMocks());

  it('logs request ID, method, route template, status and duration', async () => {
    const capture = captureLogger();
    const { app } = createHarness({}, { logger: capture.logger });
    const client = await loggedInClient(app, uniqueEmail('reqlog'));
    const created = await client.send('post', '/api/v1/resources', { url: 'https://a.example/' });
    const id = (created.body as unknown as { resource: { id: string } }).resource.id;
    const res = await client.send('get', `/api/v1/resources/${id}`);
    await supertest(app).get('/api/v1/nope');
    await supertest(app).get('/healthz');

    const lines = completions(capture.lines);
    const get = lines.find(
      (line) => (line.req as { id: string }).id === res.headers['x-request-id'],
    );
    expect(get).toMatchObject({
      level: 30,
      req: { method: 'GET' },
      res: { statusCode: 200 },
      route: '/api/v1/resources/:id',
    });
    expect(get?.userId).toMatch(/^[0-9a-f]{24}$/);
    expect(typeof get?.responseTime).toBe('number');
    expect(JSON.stringify(get)).not.toContain(id);
    const routes = lines.map((line) => line.route);
    expect(routes).toEqual(
      expect.arrayContaining([
        '/api/v1/auth/signup',
        '/api/v1/auth/login',
        '/api/v1/resources',
        'unmatched',
        '/healthz',
      ]),
    );
  });

  it('records the error code, so failed logins can be counted (NFR-O3)', async () => {
    const capture = captureLogger();
    const { app } = createHarness({}, { logger: capture.logger });
    const email = uniqueEmail('failedlogin');
    const client = await loggedInClient(app, email);
    await client.login(email, 'not-the-password');

    const failed = completions(capture.lines).find(
      (line) => line.route === '/api/v1/auth/login' && line.errorCode,
    );
    expect(failed).toMatchObject({ level: 40, errorCode: 'INVALID_CREDENTIALS' });
  });
});

describe('NFR-O2: unexpected errors reach the error reporter', () => {
  useMigratedDb();
  afterEach(() => vi.restoreAllMocks());

  it('reports 500s with request ID, route and user ID, and never 4xx', async () => {
    const reporter = new FakeReporter();
    const { app } = createHarness({}, { errorReporter: reporter });
    const client = await loggedInClient(app, uniqueEmail('reporter'));
    await client.send('get', '/api/v1/resources/000000000000000000000000');
    await client.send('post', '/api/v1/resources', { url: 'ftp://nope.example' });
    expect(reporter.captured).toHaveLength(0);

    const failure = new Error('database fell over');
    vi.spyOn(ResourceService.prototype, 'list').mockRejectedValueOnce(failure);
    const res = await client.send('get', '/api/v1/resources');
    expect(res.status).toBe(500);
    expect(reporter.captured).toHaveLength(1);
    const [report] = reporter.captured;
    expect(report?.error).toBe(failure);
    expect(report?.context).toMatchObject({
      requestId: res.headers['x-request-id'],
      route: '/api/v1/resources',
    });
    expect(report?.context.userId).toMatch(/^[0-9a-f]{24}$/);
  });
});
