import type { RequestHandler } from 'express';
import type { Clock } from './clock.js';

export type CheckStatus = 'ok' | 'fail';

export interface DependencyCheck {
  name: string;
  /** A failing critical check makes the instance not ready (503). */
  critical: boolean;
  /** Results are reused for this long, so frequent probes do not load the dependency. */
  cacheMs: number;
  timeoutMs: number;
  run(): Promise<boolean>;
}

async function withTimeout(check: DependencyCheck): Promise<CheckStatus> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), check.timeoutMs);
  });
  try {
    return (await Promise.race([check.run(), timeout])) ? 'ok' : 'fail';
  } catch {
    return 'fail';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * NFR-A2: `/readyz` checks the database and the email provider. The database is critical
 * (503, take the instance out of rotation). Email is not: an email outage degrades signup
 * but sessions and libraries keep working (OQ-44, docs/runbooks/email-provider-outage.md).
 * The body names each dependency with ok or fail and nothing else.
 */
export function readinessHandler(checks: DependencyCheck[], clock: Clock): RequestHandler {
  const cache = new Map<string, { status: CheckStatus; at: number }>();

  async function statusOf(check: DependencyCheck): Promise<CheckStatus> {
    const now = clock.now().getTime();
    const cached = cache.get(check.name);
    if (cached && now - cached.at < check.cacheMs) return cached.status;
    const status = await withTimeout(check);
    cache.set(check.name, { status, at: now });
    return status;
  }

  return async (_req, res) => {
    const results = await Promise.all(
      checks.map(async (check) => ({ check, status: await statusOf(check) })),
    );
    const criticalFailed = results.some((r) => r.check.critical && r.status === 'fail');
    const anyFailed = results.some((r) => r.status === 'fail');
    res.setHeader('Cache-Control', 'no-store');
    res.status(criticalFailed ? 503 : 200).json({
      status: criticalFailed ? 'unavailable' : anyFailed ? 'degraded' : 'ready',
      checks: Object.fromEntries(results.map((r) => [r.check.name, r.status])),
    });
  };
}
