import { describe, expect, it } from 'vitest';
import { RESOURCE_LIMITS } from './constants.js';
import { hostnameOf, isHttpUrl, normalizeUrl } from './url.js';

describe('normalizeUrl (FR-U1, FR-U2, AC-9)', () => {
  it.each([
    ['https://example.com', 'https://example.com'],
    ['http://example.com/a?b=c#d', 'http://example.com/a?b=c#d'],
    ['  https://example.com/path  ', 'https://example.com/path'],
    ['example.com', 'https://example.com'],
    ['example.com:8080/x', 'https://example.com:8080/x'],
    ['localhost:3000', 'https://localhost:3000'],
    ['HTTPS://Example.com/Case', 'HTTPS://Example.com/Case'],
    ['https://[::1]:8080/', 'https://[::1]:8080/'],
  ])('accepts %j as %j', (input, expected) => {
    expect(normalizeUrl(input)).toEqual({ ok: true, url: expected });
  });

  it('keeps the exact original text instead of the serialized URL (AC-6)', () => {
    const result = normalizeUrl('https://EXAMPLE.com');
    expect(result).toEqual({ ok: true, url: 'https://EXAMPLE.com' });
  });

  it.each([
    ['javascript:alert(1)', 'unsupported_scheme'],
    ['JavaScript:alert(1)', 'unsupported_scheme'],
    ['data:text/html,<script>alert(1)</script>', 'unsupported_scheme'],
    ['mailto:someone@example.com', 'unsupported_scheme'],
    ['ftp://example.com/file', 'unsupported_scheme'],
    ['file:///etc/passwd', 'unsupported_scheme'],
    ['', 'empty'],
    ['   ', 'empty'],
    ['hello', 'malformed'],
    ['https://exa mple.com', 'malformed'],
    ['https://', 'malformed'],
    ['https://.example.com', 'malformed'],
    ['https://example.', 'malformed'],
    ['http://%zz', 'malformed'],
  ])('rejects %j (%s)', (input, reason) => {
    expect(normalizeUrl(input)).toEqual({ ok: false, reason });
  });

  it('enforces the 2048-character limit after adding the scheme', () => {
    const path = 'a'.repeat(RESOURCE_LIMITS.urlMax - 'https://example.com/'.length);
    expect(normalizeUrl(`https://example.com/${path}`).ok).toBe(true);
    // 2048 characters typed without a scheme becomes 2049 once https:// is added.
    expect(normalizeUrl(`example.com/${path}a`)).toEqual({ ok: false, reason: 'too_long' });
  });
});

describe('isHttpUrl (NFR-S17)', () => {
  it('allows only http and https', () => {
    expect(isHttpUrl('https://example.com')).toBe(true);
    expect(isHttpUrl('http://example.com')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
  });
});

describe('hostnameOf (FR-R2, FR-R5)', () => {
  it('returns the hostname, or an empty string for invalid input', () => {
    expect(hostnameOf('https://docs.example.com/a/b')).toBe('docs.example.com');
    expect(hostnameOf('nope')).toBe('');
  });
});
