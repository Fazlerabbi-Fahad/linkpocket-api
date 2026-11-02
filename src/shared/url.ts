import { RESOURCE_LIMITS } from './constants.js';

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: UrlRejection };

export type UrlRejection = 'empty' | 'too_long' | 'unsupported_scheme' | 'malformed';

const HAS_AUTHORITY_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
// "javascript:alert(1)", "mailto:a@b.c", "data:text/html,...": a scheme with no "//".
// "example.com:8080/path" is not one: the part after the colon starts with a port number.
const BARE_SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

/**
 * FR-U1, FR-U2: trims the input, prepends `https://` when no scheme is given, and accepts
 * only http and https. Returns the trimmed original text (plus any added scheme), not the
 * WHATWG-serialized form, so Copy URL (AC-6) gives back exactly what the user saved.
 */
export function normalizeUrl(input: string): UrlCheck {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: false, reason: 'empty' };

  let candidate: string;
  if (HAS_AUTHORITY_SCHEME.test(trimmed)) {
    candidate = trimmed;
  } else if (BARE_SCHEME.test(trimmed)) {
    return { ok: false, reason: 'unsupported_scheme' };
  } else {
    candidate = `https://${trimmed}`;
  }

  if (candidate.length > RESOURCE_LIMITS.urlMax) return { ok: false, reason: 'too_long' };
  if (/\s/.test(candidate)) return { ok: false, reason: 'malformed' };

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported_scheme' };
  }
  if (!isPlausibleHost(parsed.hostname)) return { ok: false, reason: 'malformed' };

  return { ok: true, url: candidate };
}

function isPlausibleHost(hostname: string): boolean {
  if (hostname === '') return false;
  if (hostname === 'localhost') return true;
  if (hostname.startsWith('[')) return true; // IPv6 literal, already validated by URL
  // Require a dot so that typos such as "hello" are not saved as https://hello.
  return hostname.includes('.') && !hostname.startsWith('.') && !hostname.endsWith('.');
}

/** NFR-S17: only http(s) URLs are rendered as clickable links. */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** FR-R2, FR-R5: the hostname shown as the domain and used as the default title. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
