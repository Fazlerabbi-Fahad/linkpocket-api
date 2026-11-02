import express from 'express';
import supertest from 'supertest';
import { describe, expect, it } from 'vitest';
import { CSRF_COOKIE, CSRF_HEADER } from '../src/auth/cookies.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createLogger } from '../src/lib/logger.js';
import { pinoHttp } from 'pino-http';
import { useMigratedDb } from './migrated-db.js';
import {
  STRONG_PASSWORD,
  TestClient,
  createHarness,
  loggedInClient,
  typed,
  uniqueEmail,
} from './harness.js';

describe('CSRF double-submit (NFR-S10)', () => {
  useMigratedDb();
  const { app } = createHarness();

  it('rejects a state-changing request without the header', async () => {
    const client = await new TestClient(app).init();
    const res = await client.send(
      'post',
      '/api/v1/auth/login',
      { email: 'a@b.co', password: 'x' },
      { csrf: false },
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('rejects a header that does not match the cookie', async () => {
    const client = await new TestClient(app).init();
    const other = await new TestClient(app).init();
    const res = await client.send(
      'post',
      '/api/v1/auth/login',
      { email: 'a@b.co', password: 'x' },
      { csrf: false, headers: { [CSRF_HEADER]: other.csrfToken() ?? '' } },
    );
    expect(res.status).toBe(403);
  });

  it('rejects a forged token even when header and cookie match', async () => {
    const client = new TestClient(app);
    client.cookies.set(CSRF_COOKIE, 'forged.token');
    const res = await client.send('post', '/api/v1/auth/login', { email: 'a@b.co', password: 'x' });
    expect(res.status).toBe(403);
  });

  it('binds tokens to the session: a pre-login token stops working after login', async () => {
    const email = uniqueEmail('csrf');
    const client = await loggedInClient(app, email);
    const anonymous = await new TestClient(app).init();
    const res = await client.send(
      'post',
      '/api/v1/auth/change-password',
      {
        currentPassword: STRONG_PASSWORD,
        newPassword: 'n3w-pass-phrase-ok',
      },
      { csrf: false, headers: { [CSRF_HEADER]: anonymous.csrfToken() ?? '' } },
    );
    expect(res.status).toBe(403);
  });

  it('does not require a token for GET', async () => {
    expect((await new TestClient(app).send('get', '/api/v1/auth/csrf')).status).toBe(200);
  });
});

describe('input and error handling', () => {
  useMigratedDb();
  const { app } = createHarness();

  it('rejects Mongo operators in the body (NFR-S6)', async () => {
    const client = await new TestClient(app).init();
    const res = await client.send('post', '/api/v1/auth/login', {
      email: { $ne: null },
      password: { $gt: '' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects bodies over 100 KB (NFR-S7)', async () => {
    const client = await new TestClient(app).init();
    const res = await client.send('post', '/api/v1/auth/signup', {
      email: 'big@example.com',
      password: STRONG_PASSWORD,
      acceptPrivacyPolicy: true,
      name: 'x'.repeat(110 * 1024),
    });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects malformed JSON with the envelope', async () => {
    const client = await new TestClient(app).init();
    const res = typed(
      await supertest(app)
        .post('/api/v1/auth/login')
        .set('Cookie', client.cookieHeader())
        .set(CSRF_HEADER, client.csrfToken() ?? '')
        .set('Content-Type', 'application/json')
        .send('{"email":'),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns field errors for invalid input', async () => {
    const client = await new TestClient(app).init();
    const res = await client.send('post', '/api/v1/auth/login', { email: 'nope', password: '' });
    expect(res.body.error.fields.map((f: { path: string }) => f.path).sort()).toEqual([
      'email',
      'password',
    ]);
  });

  it('returns a 404 envelope for unknown routes', async () => {
    const res = await supertest(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Not found.', requestId: res.headers['x-request-id'] },
    });
  });

  it('never returns stack traces or internal messages (NFR-S8)', async () => {
    const mini = express();
    mini.use(pinoHttp({ logger: createLogger('silent'), genReqId: () => 'req-123' }));
    mini.get('/boom', () => {
      throw new Error('secret internal detail at /srv/app.js:10');
    });
    mini.use(errorHandler);
    const res = await supertest(mini).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL', message: 'Something went wrong.', requestId: 'req-123' },
    });
    expect(res.text).not.toMatch(/secret|stack|app\.js/);
  });
});

describe('transport security (NFR-S11)', () => {
  useMigratedDb();
  const { app } = createHarness();

  it('sets helmet headers and a request ID', async () => {
    const res = await supertest(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('allows CORS only for WEB_ORIGIN', async () => {
    const allowed = await supertest(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await supertest(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(denied.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });
});
