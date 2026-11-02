import { z } from 'zod';

/**
 * Error codes returned in `{ error: { code, message, requestId } }` (SRS Section 6).
 * Codes are stable API contract: add new ones, never rename or reuse.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_URL: 'INVALID_URL',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  REAUTH_REQUIRED: 'REAUTH_REQUIRED',
  PASSWORD_TOO_WEAK: 'PASSWORD_TOO_WEAK',
  VERIFICATION_LINK_INVALID: 'VERIFICATION_LINK_INVALID',
  CSRF_INVALID: 'CSRF_INVALID',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INTERNAL: 'INTERNAL',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Default HTTP status for each code. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  INVALID_URL: 400,
  UNAUTHENTICATED: 401,
  EMAIL_NOT_VERIFIED: 403,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_LOCKED: 429,
  ACCOUNT_DISABLED: 403,
  SESSION_EXPIRED: 401,
  REAUTH_REQUIRED: 401,
  PASSWORD_TOO_WEAK: 400,
  VERIFICATION_LINK_INVALID: 400,
  CSRF_INVALID: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404, // FR-R6: also used for other users' resources
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL: 500,
  SERVICE_UNAVAILABLE: 503,
};

/** Generic, user-safe messages (NFR-S8). The API never sends stack traces or internals. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'Some fields are invalid.',
  INVALID_URL: 'Enter a valid http or https URL.',
  UNAUTHENTICATED: 'Please log in.',
  EMAIL_NOT_VERIFIED: 'Verify your email to continue.',
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  ACCOUNT_LOCKED: 'Too many attempts. Try again in 15 minutes.',
  ACCOUNT_DISABLED: 'This account is disabled.',
  SESSION_EXPIRED: 'Your session has expired. Please log in again.',
  REAUTH_REQUIRED: 'Please confirm your password.',
  PASSWORD_TOO_WEAK: 'Choose a stronger password.',
  VERIFICATION_LINK_INVALID: 'This verification link is invalid or has expired.',
  CSRF_INVALID: 'Your request could not be verified. Refresh and try again.',
  FORBIDDEN: 'You do not have access to this.',
  NOT_FOUND: 'Not found.',
  RATE_LIMITED: 'Too many requests. Please wait and try again.',
  PAYLOAD_TOO_LARGE: 'Request is too large.',
  INTERNAL: 'Something went wrong.',
  SERVICE_UNAVAILABLE: 'Service temporarily unavailable.',
};

const errorCodeValues = Object.values(ERROR_CODES) as [ErrorCode, ...ErrorCode[]];

export const fieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.enum(errorCodeValues),
    message: z.string(),
    requestId: z.string(),
    fields: z.array(fieldErrorSchema).optional(),
  }),
});

export type FieldError = z.infer<typeof fieldErrorSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export function buildErrorResponse(
  code: ErrorCode,
  requestId: string,
  fields?: FieldError[],
): ErrorResponse {
  return {
    error: {
      code,
      message: ERROR_MESSAGES[code],
      requestId,
      ...(fields && fields.length > 0 ? { fields } : {}),
    },
  };
}
