import { z } from 'zod';

/**
 * Environment configuration (SRS 7.3), parsed once at startup. Secrets come from the hosting
 * provider's secret manager in staging and production (NFR-S13) and are never logged.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  MONGODB_URI: z.string().min(1),
  // HS256 signing key: at least 32 bytes of entropy (ADR-0004).
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  WEB_ORIGIN: z.url(),
  // Number of reverse proxies in front of the API (ADR-0002). 0 locally, 1 behind Vercel.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  // Set to "false" only for offline development; FR-A10 still applies the common list.
  HIBP_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  // Resend (FR-A2). Required in production; without a key, development logs emails instead.
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).optional(),
  // End-to-end tests only: write emails to this directory instead of sending them.
  EMAIL_OUTBOX_DIR: z.string().min(1).optional(),
  // Which deployment this is. Defaults to "production" when NODE_ENV is, else "local".
  APP_ENV: z.enum(['local', 'staging', 'production']).optional(),
  // Sentry (NFR-O2). Unset: errors are logged only.
  SENTRY_DSN: z.url().optional(),
  // Release name for Sentry, normally the commit SHA (Render sets RENDER_GIT_COMMIT).
  SENTRY_RELEASE: z.string().min(1).optional(),
  RENDER_GIT_COMMIT: z.string().min(1).optional(),
  // Staging load tests only (NFR-P5): multiplies every per-IP limit. Refused in production.
  RATE_LIMIT_MULTIPLIER: z.coerce.number().int().min(1).max(1000).default(1),
});

export interface RateLimitRule {
  windowMs: number;
  limit: number;
}

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  appEnv: 'local' | 'staging' | 'production';
  /** Null when SENTRY_DSN is unset. */
  sentry: { dsn: string; release: string | undefined } | null;
  port: number;
  logLevel: string;
  mongoUri: string;
  jwtSecret: string;
  webOrigin: string;
  trustProxyHops: number;
  hibpEnabled: boolean;
  /** Absent outside production when no key is set: emails are logged, not sent. */
  email: { resendApiKey: string; from: string } | null;
  /** E2E only; never set in production. */
  emailOutboxDir: string | null;
  /** Argon2id parameters (NFR-S1). Lowered only in tests, see loadConfig. */
  passwordHash: { memoryCost: number; timeCost: number; parallelism: number };
  /** 1 except during staging load tests (RATE_LIMIT_MULTIPLIER). */
  rateLimitMultiplier: number;
  /** Per-IP limits (NFR-S14). Per-email lockout (FR-A9) is separate. */
  rateLimits: {
    global: RateLimitRule;
    login: RateLimitRule;
    signup: RateLimitRule;
    changePassword: RateLimitRule;
    resendVerification: RateLimitRule;
    verifyEmail: RateLimitRule;
    accountExport: RateLimitRule;
    accountDelete: RateLimitRule;
    admin: RateLimitRule;
    adminStatus: RateLimitRule;
  };
}

const MINUTE = 60_000;

/** OWASP Password Storage Cheat Sheet minimum for Argon2id: 19 MiB, 2 iterations, 1 lane. */
export const ARGON2_PRODUCTION = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const ARGON2_TEST = { memoryCost: 1024, timeCost: 1, parallelism: 1 } as const;

export const DEFAULT_RATE_LIMITS: AppConfig['rateLimits'] = {
  global: { windowMs: 15 * MINUTE, limit: 600 },
  login: { windowMs: 15 * MINUTE, limit: 30 },
  signup: { windowMs: 60 * MINUTE, limit: 10 },
  changePassword: { windowMs: 15 * MINUTE, limit: 10 },
  // Per IP. The per-account FR-A4 limit (1 per minute, 5 per hour) is enforced separately.
  resendVerification: { windowMs: 60 * MINUTE, limit: 20 },
  verifyEmail: { windowMs: 15 * MINUTE, limit: 30 },
  // Export builds the whole library; delete checks a password (OQ-31).
  accountExport: { windowMs: 60 * MINUTE, limit: 10 },
  accountDelete: { windowMs: 15 * MINUTE, limit: 10 },
  // NFR-S14: every admin endpoint; status changes also check a password (FR-AD10).
  admin: { windowMs: 15 * MINUTE, limit: 300 },
  adminStatus: { windowMs: 15 * MINUTE, limit: 30 },
};

function scaleRateLimits(
  limits: AppConfig['rateLimits'],
  multiplier: number,
): AppConfig['rateLimits'] {
  if (multiplier === 1) return limits;
  return Object.fromEntries(
    Object.entries(limits).map(([name, rule]) => [
      name,
      { ...rule, limit: rule.limit * multiplier },
    ]),
  ) as AppConfig['rateLimits'];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Report variable names only, never values.
    const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  const values = parsed.data;
  const missingEmail = [
    values.RESEND_API_KEY === undefined && 'RESEND_API_KEY',
    values.EMAIL_FROM === undefined && 'EMAIL_FROM',
  ].filter((name): name is string => typeof name === 'string');
  if (values.NODE_ENV === 'production' && values.EMAIL_OUTBOX_DIR !== undefined) {
    throw new Error('Invalid environment configuration: EMAIL_OUTBOX_DIR');
  }
  const appEnv = values.APP_ENV ?? (values.NODE_ENV === 'production' ? 'production' : 'local');
  if (appEnv === 'production' && values.RATE_LIMIT_MULTIPLIER !== 1) {
    throw new Error('Invalid environment configuration: RATE_LIMIT_MULTIPLIER');
  }
  if (values.NODE_ENV === 'production' && missingEmail.length > 0) {
    throw new Error(`Invalid environment configuration: ${missingEmail.join(', ')}`);
  }
  return {
    env: values.NODE_ENV,
    appEnv,
    sentry: values.SENTRY_DSN
      ? { dsn: values.SENTRY_DSN, release: values.SENTRY_RELEASE ?? values.RENDER_GIT_COMMIT }
      : null,
    port: values.PORT,
    logLevel: values.LOG_LEVEL,
    mongoUri: values.MONGODB_URI,
    jwtSecret: values.JWT_SECRET,
    webOrigin: new URL(values.WEB_ORIGIN).origin,
    trustProxyHops: values.TRUST_PROXY_HOPS,
    hibpEnabled: values.HIBP_ENABLED,
    email:
      values.RESEND_API_KEY !== undefined && values.EMAIL_FROM !== undefined
        ? { resendApiKey: values.RESEND_API_KEY, from: values.EMAIL_FROM }
        : null,
    emailOutboxDir: values.EMAIL_OUTBOX_DIR ?? null,
    passwordHash: values.NODE_ENV === 'test' ? ARGON2_TEST : ARGON2_PRODUCTION,
    rateLimitMultiplier: values.RATE_LIMIT_MULTIPLIER,
    rateLimits: scaleRateLimits(DEFAULT_RATE_LIMITS, values.RATE_LIMIT_MULTIPLIER),
  };
}
