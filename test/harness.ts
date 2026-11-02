import type { CurrentUser } from '../src/shared/index.js';
import type { Express } from 'express';
import supertest, { type Response } from 'supertest';
import { createApp, type AppDeps } from '../src/app.js';
import { CSRF_COOKIE, CSRF_HEADER } from '../src/auth/cookies.js';
import type { BreachChecker, BreachResult } from '../src/auth/password-screening.js';
import { DEFAULT_RATE_LIMITS, loadConfig, type AppConfig } from '../src/config.js';
import { UserModel } from '../src/db/models/index.js';
import { EmailDispatcher } from '../src/email/dispatcher.js';
import { EmailSendError, type EmailMessage, type EmailTransport } from '../src/email/transport.js';
import type { Clock } from '../src/lib/clock.js';
import { createLogger } from '../src/lib/logger.js';

/** The shapes the auth API returns, so tests read `res.body` with types instead of `any`. */
export interface ApiBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    fields: { path: string; message: string }[];
  };
  user: CurrentUser;
  csrfToken: string;
  message: string;
}

export type ApiResponse = Omit<Response, 'body'> & { body: ApiBody };

/** What NFR-S15 compares: status, body and headers, minus per-request values. */
export function comparable(res: ApiResponse) {
  const headers = { ...res.headers };
  for (const name of ['date', 'x-request-id', 'ratelimit', 'ratelimit-policy', 'etag']) {
    delete headers[name];
  }
  const body: unknown = res.body.error
    ? { error: { ...res.body.error, requestId: '<per-request>' } }
    : res.body;
  return { status: res.status, body, headers };
}

/** Types a raw Supertest response the same way. */
export function typed(res: Response): ApiResponse {
  return res;
}

export const STRONG_PASSWORD = 'quiet-harbor-lantern-42';
export const OTHER_STRONG_PASSWORD = 'amber-willow-compass-77';

export class FakeClock implements Clock {
  private time = Date.now();
  now(): Date {
    return new Date(this.time);
  }
  advance(ms: number): void {
    this.time += ms;
  }
  set(date: Date): void {
    this.time = date.getTime();
  }
}

export class FakeBreachChecker implements BreachChecker {
  readonly breached = new Set<string>();
  result: BreachResult | null = null;
  check(password: string): Promise<BreachResult> {
    if (this.result) return Promise.resolve(this.result);
    return Promise.resolve(this.breached.has(password) ? 'breached' : 'clean');
  }
}

/**
 * Records every email instead of sending it. `failures` makes the next sends fail, to test
 * NFR-A4 retries.
 */
export class FakeEmailTransport implements EmailTransport {
  readonly sent: EmailMessage[] = [];
  attempts = 0;
  failures: Error[] = [];

  send(message: EmailMessage): Promise<void> {
    this.attempts += 1;
    const failure = this.failures.shift();
    if (failure) return Promise.reject(failure);
    this.sent.push(message);
    return Promise.resolve();
  }

  to(email: string): EmailMessage[] {
    return this.sent.filter((message) => message.to === email);
  }

  /** The token from the newest verification email to `email`. */
  latestToken(email: string): string {
    const message = this.to(email).at(-1);
    const token = message?.text.match(/#token=([A-Za-z0-9_-]{43})/)?.[1];
    if (!token) throw new Error(`no verification email for ${email}`);
    return token;
  }
}

export { EmailSendError };

const HIGH_LIMIT = { windowMs: 60_000, limit: 10_000 };

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base = loadConfig({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://unused-in-tests',
    // Test-only signing secret; not a real credential.
    JWT_SECRET: 'test-only-secret-'.padEnd(48, 'x'),
    WEB_ORIGIN: 'http://localhost:3000',
    LOG_LEVEL: 'silent',
    HIBP_ENABLED: 'false',
  });
  return {
    ...base,
    rateLimits: {
      global: HIGH_LIMIT,
      login: HIGH_LIMIT,
      signup: HIGH_LIMIT,
      changePassword: HIGH_LIMIT,
      resendVerification: HIGH_LIMIT,
      verifyEmail: HIGH_LIMIT,
      accountExport: HIGH_LIMIT,
      accountDelete: HIGH_LIMIT,
      admin: HIGH_LIMIT,
      adminStatus: HIGH_LIMIT,
    },
    ...overrides,
  };
}

export interface Harness {
  app: Express;
  clock: FakeClock;
  breach: FakeBreachChecker;
  config: AppConfig;
  mail: FakeEmailTransport;
  /** Delays the dispatcher waited between retries (no real waiting in tests). */
  retryDelays: number[];
  /** Waits until queued emails are delivered or have failed. */
  emailsSettled: () => Promise<void>;
}

/** App dependencies a test may replace (observability tests capture logs and reports). */
export type HarnessDeps = Partial<Pick<AppDeps, 'logger' | 'errorReporter' | 'dependencyChecks'>>;

export function createHarness(overrides: Partial<AppConfig> = {}, deps: HarnessDeps = {}): Harness {
  const clock = new FakeClock();
  const breach = new FakeBreachChecker();
  const config = testConfig(overrides);
  const logger = deps.logger ?? createLogger('silent');
  const mail = new FakeEmailTransport();
  const retryDelays: number[] = [];
  const emailDispatcher = new EmailDispatcher(mail, logger, undefined, (ms) => {
    retryDelays.push(ms);
    return Promise.resolve();
  });
  const app = createApp({
    ...deps,
    config,
    logger,
    clock,
    breachChecker: breach,
    emailDispatcher,
  });
  return {
    app,
    clock,
    breach,
    config,
    mail,
    retryDelays,
    emailsSettled: () => emailDispatcher.idle(),
  };
}

export { DEFAULT_RATE_LIMITS };

type Method = 'get' | 'post' | 'patch' | 'delete';

/**
 * A browser-like client: keeps cookies (including Secure ones over plain HTTP in tests) and
 * echoes the CSRF cookie in the X-CSRF-Token header, like the web app will.
 */
export class TestClient {
  readonly cookies = new Map<string, string>();

  constructor(private readonly app: Express) {}

  cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  csrfToken(): string | undefined {
    return this.cookies.get(CSRF_COOKIE);
  }

  private store(res: Response): void {
    const header = res.headers['set-cookie'] as unknown;
    const lines = Array.isArray(header) ? (header as string[]) : [];
    for (const line of lines) {
      const [pair = '', ...attributes] = line.split(';').map((part) => part.trim());
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      const expired = attributes.some(
        (attribute) => /^max-age=0$/i.test(attribute) || /^expires=.*1970/i.test(attribute),
      );
      if (expired || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async send(
    method: Method,
    path: string,
    body?: unknown,
    options: { csrf?: boolean; headers?: Record<string, string> } = {},
  ): Promise<ApiResponse> {
    let request = supertest(this.app)[method](path);
    const cookie = this.cookieHeader();
    if (cookie) request = request.set('Cookie', cookie);
    const token = this.csrfToken();
    if (method !== 'get' && options.csrf !== false && token)
      request = request.set(CSRF_HEADER, token);
    for (const [name, value] of Object.entries(options.headers ?? {}))
      request = request.set(name, value);
    const res = body === undefined ? await request : await request.send(body as object);
    this.store(res);
    return typed(res);
  }

  /** Fetches a CSRF token for the current session (or anonymous). */
  async init(): Promise<this> {
    await this.send('get', '/api/v1/auth/csrf');
    return this;
  }

  signup(
    email: string,
    password = STRONG_PASSWORD,
    extra: Record<string, unknown> = {},
  ): Promise<ApiResponse> {
    return this.send('post', '/api/v1/auth/signup', {
      email,
      password,
      acceptPrivacyPolicy: true,
      ...extra,
    });
  }

  login(email: string, password = STRONG_PASSWORD): Promise<ApiResponse> {
    return this.send('post', '/api/v1/auth/login', { email, password });
  }

  me(): Promise<ApiResponse> {
    return this.send('get', '/api/v1/auth/me');
  }

  logout(): Promise<ApiResponse> {
    return this.send('post', '/api/v1/auth/logout');
  }

  verifyEmail(token: unknown): Promise<ApiResponse> {
    return this.send('post', '/api/v1/auth/verify-email', { token });
  }

  resendVerification(email: string): Promise<ApiResponse> {
    return this.send('post', '/api/v1/auth/resend-verification', { email });
  }

  changePassword(currentPassword: string, newPassword: string): Promise<ApiResponse> {
    return this.send('post', '/api/v1/auth/change-password', { currentPassword, newPassword });
  }
}

/** Signs up through the API, then marks the email verified (the verify endpoint is Phase 4). */
export async function createVerifiedUser(
  app: Express,
  email: string,
  password = STRONG_PASSWORD,
  role: 'user' | 'admin' = 'user',
): Promise<TestClient> {
  const client = await new TestClient(app).init();
  const res = await client.signup(email, password);
  if (res.status !== 202) throw new Error(`signup failed: ${res.status}`);
  await UserModel.updateOne({ email }, { $set: { emailVerifiedAt: new Date(), role } });
  return client;
}

/** A logged-in, verified user's client. */
export async function loggedInClient(
  app: Express,
  email: string,
  password = STRONG_PASSWORD,
  role: 'user' | 'admin' = 'user',
): Promise<TestClient> {
  const client = await createVerifiedUser(app, email, password, role);
  const res = await client.login(email, password);
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  return client;
}

let counter = 0;
export function uniqueEmail(label = 'user'): string {
  counter += 1;
  return `${label}.${counter}.${Math.random().toString(36).slice(2, 8)}@example.com`;
}
