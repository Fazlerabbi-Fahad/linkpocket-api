/**
 * Limits and timings from the SRS. The API, the web app and the Mongoose models all read
 * these values so that NFR-S7 ("limits match the data model") holds by construction.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Section 5.1 (users) */
export const USER_LIMITS = {
  emailMax: 254,
  nameMax: 100,
  passwordMin: 8, // FR-A10
  passwordMax: 128, // FR-A10
} as const;

/** Section 5.2 (resources), FR-R1 */
export const RESOURCE_LIMITS = {
  urlMax: 2048,
  titleMax: 300,
  noteMax: 1000,
  tagsMax: 10,
  tagMax: 30,
} as const;

/** `sessions` collection (clarification 1). userAgent is not in the SRS: see OQ-4. */
export const SESSION_LIMITS = {
  userAgentMax: 512,
} as const;

export const PAGINATION = {
  libraryPageSize: 50, // FR-L5
  adminUsersPageSize: 25, // FR-AD5
} as const;

export const TIMINGS = {
  verificationLinkTtlMs: 24 * HOUR, // FR-A2
  resendMinIntervalMs: 60 * SECOND, // FR-A4
  resendMaxPerHour: 5, // FR-A4
  resendWindowMs: HOUR, // FR-A4, users.verificationEmailSentAt pruning
  loginLockoutAttempts: 5, // FR-A9
  loginLockoutWindowMs: 15 * MINUTE, // FR-A9
  loginLockoutDurationMs: 15 * MINUTE, // FR-A9
  sessionIdleTimeoutMs: 7 * DAY, // FR-A8
  adminSessionAbsoluteMs: 24 * HOUR, // FR-A8, clarification 5
  unverifiedAccountMaxAgeMs: 7 * DAY, // FR-A12
  lastActiveUpdateIntervalMs: HOUR, // Section 5.1 lastActiveAt
  accountDeletionMaxDays: 30, // FR-D2
  copyFeedbackMs: 2 * SECOND, // FR-C2
  searchDebounceMs: 300, // FR-L2
} as const;

export const RETENTION = {
  auditLogSeconds: 365 * 24 * 60 * 60, // NFR-B5, Section 5.3 TTL
  appLogDays: 30, // NFR-B5
  backupDays: 35, // NFR-B3
} as const;

/** NFR-S7 */
export const REQUEST_BODY_LIMIT = '100kb';

export const API_PREFIX = '/api/v1'; // NFR-M6

/**
 * Web page that verification links open (FR-A5). The token travels in the URL fragment,
 * which browsers never send to servers, so it stays out of access logs and Referer headers.
 */
export const VERIFY_EMAIL_PATH = '/verify-email';

/** NFR-S9 */
export const VERIFICATION_TOKEN_BYTES = 32;
