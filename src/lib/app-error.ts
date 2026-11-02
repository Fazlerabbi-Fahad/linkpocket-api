import { ERROR_STATUS, type ErrorCode, type FieldError } from '../shared/index.js';

/** An expected failure with a stable code. The error handler turns it into the envelope. */
export class AppError extends Error {
  override name = 'AppError';
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly fields?: FieldError[],
  ) {
    super(code);
    this.status = ERROR_STATUS[code];
  }
}
