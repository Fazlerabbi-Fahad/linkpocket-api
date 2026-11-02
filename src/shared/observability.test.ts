import { describe, expect, it } from 'vitest';
import { redactSensitiveText, scrubErrorEvent } from './observability.js';

describe('NFR-B6, NFR-O2: error event scrubbing', () => {
  it('replaces URLs and email addresses in text', () => {
    expect(
      redactSensitiveText(
        'E11000 dup key: { email: "pat@example.com" } while saving https://secret.example/a?b=1',
      ),
    ).toBe('E11000 dup key: { email: "[email]" } while saving [url]');
    expect(redactSensitiveText('ftp://x.example and mailto:a@b.io')).toBe(
      '[url] and mailto:[email]',
    );
    expect(redactSensitiveText('nothing to hide')).toBe('nothing to hide');
  });

  it('drops request details, user, breadcrumbs and extra, and keeps the path', () => {
    const event = {
      event_id: 'abc',
      message: 'failed for https://private.example/page',
      exception: { values: [{ type: 'Error', value: 'bad https://x.example' }, { type: 'E' }] },
      request: {
        url: 'https://app.example/library?q=secret+search#top',
        cookies: { '__Host-lp_session': 'token' },
        headers: { cookie: 'a=b' },
        data: { password: 'hunter2' },
        query_string: 'q=secret',
        env: { REMOTE_ADDR: '1.2.3.4' },
      },
      user: { email: 'pat@example.com', ip_address: '1.2.3.4' },
      breadcrumbs: [{ category: 'ui.click', message: 'My private title' }],
      extra: { body: 'x' },
      tags: { area: 'library' },
    };
    const scrubbed = scrubErrorEvent(event);

    expect(scrubbed).toEqual({
      event_id: 'abc',
      message: 'failed for [url]',
      exception: { values: [{ type: 'Error', value: 'bad [url]' }, { type: 'E' }] },
      request: { url: 'https://app.example/library' },
      tags: { area: 'library' },
    });
    // The input is not modified.
    expect(event.user.email).toBe('pat@example.com');
  });

  it('handles events without a request URL or exception', () => {
    expect(scrubErrorEvent({ request: { headers: {} } })).toEqual({ request: {} });
    expect(scrubErrorEvent({})).toEqual({});
  });
});
