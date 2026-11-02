import supertest from 'supertest';
import { describe, expect, it } from 'vitest';
import { ResendTransport, RESEND_API_ORIGIN } from '../../src/email/resend-transport.js';
import { createHarness } from '../harness.js';
import { useMigratedDb } from '../migrated-db.js';

describe('NFR-A2: health and readiness', () => {
  useMigratedDb();

  it('/healthz answers without touching dependencies', async () => {
    const { app } = createHarness(
      {},
      { dependencyChecks: { database: () => Promise.resolve(false) } },
    );
    const res = await supertest(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('/readyz is ready when the database and email provider answer', async () => {
    const { app } = createHarness();
    const res = await supertest(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready', checks: { database: 'ok', email: 'ok' } });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('is unavailable (503) when the database fails or hangs', async () => {
    const down = createHarness(
      {},
      { dependencyChecks: { database: () => Promise.resolve(false) } },
    );
    const res = await supertest(down.app).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable', checks: { database: 'fail', email: 'ok' } });

    const throwing = createHarness(
      {},
      { dependencyChecks: { database: () => Promise.reject(new Error('no route to host')) } },
    );
    const thrown = await supertest(throwing.app).get('/readyz');
    expect(thrown.status).toBe(503);
    expect(thrown.text).not.toContain('no route');

    const hanging = createHarness(
      {},
      { dependencyChecks: { database: () => new Promise<boolean>(() => {}) } },
    );
    const started = Date.now();
    const slow = await supertest(hanging.app).get('/readyz');
    expect(slow.status).toBe(503);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('stays in rotation but reports degraded when email is down, and caches that check', async () => {
    let calls = 0;
    const harness = createHarness(
      {},
      {
        dependencyChecks: {
          email: () => {
            calls += 1;
            return Promise.resolve(false);
          },
        },
      },
    );
    const res = await supertest(harness.app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'degraded', checks: { database: 'ok', email: 'fail' } });
    await supertest(harness.app).get('/readyz');
    expect(calls).toBe(1);
    harness.clock.advance(61_000);
    await supertest(harness.app).get('/readyz');
    expect(calls).toBe(2);
  });

  it('checks Resend reachability without sending or needing read access', async () => {
    const requested: string[] = [];
    const answer = (status: number) =>
      new ResendTransport('re_placeholder', 'LinkPocket <no-reply@example.com>', (input) => {
        requested.push(input instanceof Request ? input.url : input.toString());
        return Promise.resolve(new Response(null, { status }));
      });
    expect(await answer(401).check()).toBe(true);
    expect(await answer(200).check()).toBe(true);
    expect(await answer(503).check()).toBe(false);
    expect(requested).toEqual([RESEND_API_ORIGIN, RESEND_API_ORIGIN, RESEND_API_ORIGIN]);
  });
});
