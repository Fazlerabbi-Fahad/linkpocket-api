/**
 * NFR-B6 for error tracking (NFR-O2): events leave the app without cookies, headers, bodies,
 * query strings (search terms), user details, breadcrumbs, URLs or email addresses. Used by
 * the Sentry `beforeSend` hooks in both apps.
 */
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>`]+/gi;
const EMAIL_PATTERN = /[^\s"'<>@(){}[\],;:]+@[^\s"'<>@(){}[\],;:]+\.[a-z]{2,}/gi;

/** Replaces URLs and email addresses in free text (error messages). */
export function redactSensitiveText(text: string): string {
  return text.replace(URL_PATTERN, '[url]').replace(EMAIL_PATTERN, '[email]');
}

/** The parts of an error-tracking event this scrubber reads or removes. */
export interface ScrubbableEvent {
  message?: string;
  exception?: { values?: { value?: string }[] };
  request?: {
    url?: string;
    cookies?: unknown;
    headers?: unknown;
    data?: unknown;
    query_string?: unknown;
    env?: unknown;
  };
  user?: unknown;
  breadcrumbs?: unknown;
  extra?: unknown;
}

export function scrubErrorEvent<T extends ScrubbableEvent>(event: T): T {
  const scrubbed: T = { ...event };
  delete scrubbed.user;
  delete scrubbed.breadcrumbs;
  delete scrubbed.extra;
  if (scrubbed.message !== undefined) scrubbed.message = redactSensitiveText(scrubbed.message);
  if (scrubbed.exception?.values) {
    scrubbed.exception = {
      ...scrubbed.exception,
      values: scrubbed.exception.values.map((value) =>
        value.value === undefined ? value : { ...value, value: redactSensitiveText(value.value) },
      ),
    };
  }
  if (scrubbed.request) {
    // Keep only the path: page and API paths hold IDs, never resource URLs or search terms.
    const url = scrubbed.request.url;
    scrubbed.request = url === undefined ? {} : { url: url.split(/[?#]/, 1)[0] };
  }
  return scrubbed;
}
