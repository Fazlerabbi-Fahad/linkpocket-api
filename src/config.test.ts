import { describe, expect, it } from 'vitest';
import { ARGON2_PRODUCTION, DEFAULT_RATE_LIMITS, loadConfig } from './config.js';

// Placeholder values only; no real credentials.
const email = { RESEND_API_KEY: 're_placeholder', EMAIL_FROM: 'LinkPocket <no-reply@example.com>' };

const valid = {
  MONGODB_URI: 'mongodb://localhost/linkpocket',
  JWT_SECRET: 'config-test-secret-'.padEnd(40, 'k'),
  WEB_ORIGIN: 'http://localhost:3000/',
};

describe('loadConfig', () => {
  it('applies defaults and production password-hash parameters', () => {
    const config = loadConfig(valid);
    expect(config).toMatchObject({
      env: 'development',
      port: 4000,
      trustProxyHops: 0,
      hibpEnabled: true,
      webOrigin: 'http://localhost:3000',
      passwordHash: ARGON2_PRODUCTION,
    });
  });

  it('only lowers hashing cost for NODE_ENV=test', () => {
    expect(loadConfig({ ...valid, ...email, NODE_ENV: 'production' }).passwordHash).toEqual(
      ARGON2_PRODUCTION,
    );
    expect(loadConfig({ ...valid, NODE_ENV: 'test' }).passwordHash.memoryCost).toBeLessThan(
      ARGON2_PRODUCTION.memoryCost,
    );
  });

  it('names invalid variables without echoing their values', () => {
    const attempt = () => loadConfig({ ...valid, JWT_SECRET: 'short-secret-value' });
    expect(attempt).toThrow(/JWT_SECRET/);
    expect(attempt).not.toThrow(/short-secret-value/);
    expect(() => loadConfig({})).toThrow(/MONGODB_URI/);
  });

  it('requires Resend settings in production only (FR-A2)', () => {
    expect(loadConfig(valid).email).toBeNull();
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production' })).toThrow(
      /RESEND_API_KEY, EMAIL_FROM/,
    );
    const attempt = () =>
      loadConfig({ ...valid, NODE_ENV: 'production', RESEND_API_KEY: 're_placeholder' });
    expect(attempt).toThrow(/EMAIL_FROM/);
    expect(attempt).not.toThrow(/re_placeholder/);
    expect(loadConfig({ ...valid, ...email }).email).toEqual({
      resendApiKey: 're_placeholder',
      from: 'LinkPocket <no-reply@example.com>',
    });
  });

  it('refuses the e2e email outbox in production', () => {
    expect(loadConfig({ ...valid, EMAIL_OUTBOX_DIR: '/tmp/outbox' }).emailOutboxDir).toBe(
      '/tmp/outbox',
    );
    expect(() =>
      loadConfig({ ...valid, ...email, NODE_ENV: 'production', EMAIL_OUTBOX_DIR: '/tmp/x' }),
    ).toThrow(/EMAIL_OUTBOX_DIR/);
  });

  it('derives APP_ENV and reads Sentry settings (NFR-O2)', () => {
    expect(loadConfig(valid)).toMatchObject({ appEnv: 'local', sentry: null });
    expect(loadConfig({ ...valid, ...email, NODE_ENV: 'production' }).appEnv).toBe('production');
    const staging = loadConfig({
      ...valid,
      ...email,
      NODE_ENV: 'production',
      APP_ENV: 'staging',
      SENTRY_DSN: 'https://public@o0.ingest.example/1',
      RENDER_GIT_COMMIT: 'abc123',
    });
    expect(staging.appEnv).toBe('staging');
    expect(staging.sentry).toEqual({
      dsn: 'https://public@o0.ingest.example/1',
      release: 'abc123',
    });
    expect(
      loadConfig({ ...valid, SENTRY_DSN: 'https://p@o0.ingest.example/1', SENTRY_RELEASE: 'v1' })
        .sentry?.release,
    ).toBe('v1');
  });

  it('scales rate limits for staging load tests only (NFR-P5)', () => {
    const scaled = loadConfig({ ...valid, APP_ENV: 'staging', RATE_LIMIT_MULTIPLIER: '100' });
    expect(scaled.rateLimits.global.limit).toBe(DEFAULT_RATE_LIMITS.global.limit * 100);
    expect(scaled.rateLimits.login.windowMs).toBe(DEFAULT_RATE_LIMITS.login.windowMs);
    expect(loadConfig(valid).rateLimits).toBe(DEFAULT_RATE_LIMITS);
    expect(() =>
      loadConfig({ ...valid, ...email, NODE_ENV: 'production', RATE_LIMIT_MULTIPLIER: '10' }),
    ).toThrow(/RATE_LIMIT_MULTIPLIER/);
    expect(() =>
      loadConfig({ ...valid, APP_ENV: 'production', RATE_LIMIT_MULTIPLIER: '10' }),
    ).toThrow(/RATE_LIMIT_MULTIPLIER/);
  });
});
