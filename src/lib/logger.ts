import { pino, type DestinationStream, type Logger } from 'pino';

export type { Logger };

/**
 * NFR-B6: logs never contain passwords, tokens, cookies or full resource URLs. Request bodies
 * are never logged, and these paths are redacted as a second line of defence.
 */
export const REDACT_PATHS = [
  // `*.x` only matches one level down, so top-level keys are listed too.
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'token',
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.passwordHash',
  '*.token',
];

/**
 * NFR-B6: error messages can quote input (a duplicate key's email, a cast value), so logs keep
 * the error's class, code and stack frames only. Sentry receives the scrubbed message.
 */
export function serializeError(error: unknown): Record<string, unknown> {
  if (typeof error !== 'object' || error === null) return { type: typeof error };
  // pino-http hands over pino-std-serializers' plain copy ({ type, stack, ... }), not the Error.
  const { name, type, code, stack } = error as Record<string, unknown>;
  const frames = (typeof stack === 'string' ? stack : '')
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .join('\n');
  return {
    type: typeof type === 'string' ? type : typeof name === 'string' ? name : 'Object',
    ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
    stack: frames,
  };
}

/** `destination` defaults to stdout; tests pass an in-memory stream (test/capture-logger.ts). */
export function createLogger(level: string, destination?: DestinationStream): Logger {
  const options = {
    level,
    base: { service: 'linkpocket-api' },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers: { err: serializeError },
  };
  return destination ? pino(options, destination) : pino(options);
}
