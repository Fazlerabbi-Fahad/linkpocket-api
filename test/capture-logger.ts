import { Writable } from 'node:stream';
import { createLogger, type Logger } from '../src/lib/logger.js';

/** The production logger (same redaction and serializers) keeping its JSON lines in memory. */
export function captureLogger(): {
  logger: Logger;
  lines: Record<string, unknown>[];
  raw: string[];
} {
  const raw: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      raw.push(chunk.toString('utf8'));
      done();
    },
  });
  const logger = createLogger('debug', stream);
  return {
    logger,
    raw,
    get lines() {
      return raw.map((line) => JSON.parse(line) as Record<string, unknown>);
    },
  };
}
