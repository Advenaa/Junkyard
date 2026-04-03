import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';

// We need to mock fetch before importing expandUrl, but with Node 22 built-in
// fetch we can mock it via mock.method on globalThis.

import { isShortUrl, expandUrl } from '../../src/normalize/url-expand.js';

// ---------------------------------------------------------------------------
// isShortUrl — pure function tests
// ---------------------------------------------------------------------------

describe('isShortUrl', () => {
  it('identifies t.co as a short URL host', () => {
    assert.strictEqual(isShortUrl('https://t.co/abc123'), true);
  });

  it('identifies bit.ly as a short URL host', () => {
    assert.strictEqual(isShortUrl('https://bit.ly/3xYz'), true);
  });

  it('identifies goo.gl as a short URL host', () => {
    assert.strictEqual(isShortUrl('https://goo.gl/maps/abc'), true);
  });

  it('identifies tinyurl.com as a short URL host', () => {
    assert.strictEqual(isShortUrl('https://tinyurl.com/y6abc'), true);
  });

  it('identifies ow.ly as a short URL host', () => {
    assert.strictEqual(isShortUrl('https://ow.ly/abc'), true);
  });

  it('identifies is.gd as a short URL host', () => {
    assert.strictEqual(isShortUrl('https://is.gd/abc'), true);
  });

  it('identifies buff.ly as a short URL host', () => {
    assert.strictEqual(isShortUrl('https://buff.ly/abc'), true);
  });

  it('identifies adf.ly as a short URL host', () => {
    assert.strictEqual(isShortUrl('https://adf.ly/abc'), true);
  });

  it('identifies j.mp as a short URL host', () => {
    assert.strictEqual(isShortUrl('https://j.mp/abc'), true);
  });

  it('returns false for regular URLs', () => {
    assert.strictEqual(isShortUrl('https://example.com/page'), false);
  });

  it('returns false for github.com', () => {
    assert.strictEqual(isShortUrl('https://github.com/user/repo'), false);
  });

  it('returns false for twitter.com (not a shortener)', () => {
    assert.strictEqual(isShortUrl('https://twitter.com/user/status/123'), false);
  });

  it('returns false for an invalid URL string', () => {
    assert.strictEqual(isShortUrl('not-a-url'), false);
  });

  it('returns false for an empty string', () => {
    assert.strictEqual(isShortUrl(''), false);
  });

  it('returns false for a short host used as a subdomain', () => {
    // "t.co.evil.com" should not match "t.co"
    assert.strictEqual(isShortUrl('https://t.co.evil.com/abc'), false);
  });
});

// ---------------------------------------------------------------------------
// expandUrl — requires fetch mocking
// ---------------------------------------------------------------------------

describe('expandUrl', () => {
  it('returns the original URL for an invalid URL', async () => {
    const result = await expandUrl('not-a-url');
    assert.strictEqual(result, 'not-a-url');
  });

  it('returns the original URL when response has no location header', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
      return new Response(null, { status: 200, headers: {} });
    });

    const result = await expandUrl('https://example.com/page');
    assert.strictEqual(result, 'https://example.com/page');

    assert.strictEqual(fetchMock.mock.callCount(), 1);
    const [url, opts] = fetchMock.mock.calls[0].arguments as [string, RequestInit];
    assert.strictEqual(url, 'https://example.com/page');
    assert.strictEqual(opts.method, 'HEAD');
    assert.strictEqual(opts.redirect, 'manual');

    fetchMock.mock.restore();
  });

  it('follows a single redirect to a safe HTTPS URL', async (t) => {
    // Mock DNS to return a public IP for the redirect target
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['93.184.216.34']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });

    let callCount = 0;
    const fetchMock = t.mock.method(globalThis, 'fetch', async (url: string) => {
      callCount++;
      if (callCount === 1) {
        // First call: return redirect
        return new Response(null, {
          status: 301,
          headers: { location: 'https://example.com/final-page' },
        });
      }
      // Second call: no more redirects
      return new Response(null, { status: 200 });
    });

    const result = await expandUrl('https://t.co/abc123');
    assert.strictEqual(result, 'https://example.com/final-page');

    fetchMock.mock.restore();
    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('stops following redirects when target is HTTP (non-HTTPS)', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
      return new Response(null, {
        status: 302,
        headers: { location: 'http://insecure.example.com/page' },
      });
    });

    const result = await expandUrl('https://t.co/abc123');
    // Should return the original URL since the redirect target is HTTP
    assert.strictEqual(result, 'https://t.co/abc123');

    fetchMock.mock.restore();
  });

  it('stops following redirects to private IPs (SSRF protection)', async (t) => {
    // First redirect goes to a safe URL, second redirect goes to a private IP
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async (hostname: string) => {
      if (hostname === 'safe.example.com') return ['93.184.216.34'];
      if (hostname === 'evil.example.com') return ['10.0.0.1'];
      return ['93.184.216.34'];
    });
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });

    let callCount = 0;
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(null, {
          status: 301,
          headers: { location: 'https://safe.example.com/page' },
        });
      }
      if (callCount === 2) {
        return new Response(null, {
          status: 301,
          headers: { location: 'https://evil.example.com/internal' },
        });
      }
      return new Response(null, { status: 200 });
    });

    const result = await expandUrl('https://t.co/abc123');
    // Should stop at the safe URL, not follow the redirect to the private IP
    assert.strictEqual(result, 'https://safe.example.com/page');

    fetchMock.mock.restore();
    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('stops following redirects to localhost', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://localhost/admin' },
      });
    });

    const result = await expandUrl('https://t.co/abc123');
    assert.strictEqual(result, 'https://t.co/abc123');

    fetchMock.mock.restore();
  });

  it('stops at redirect to non-standard port', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://example.com:8080/admin' },
      });
    });

    const result = await expandUrl('https://t.co/abc123');
    assert.strictEqual(result, 'https://t.co/abc123');

    fetchMock.mock.restore();
  });

  it('returns current URL when fetch throws (network error)', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('network timeout');
    });

    const result = await expandUrl('https://t.co/abc123');
    assert.strictEqual(result, 'https://t.co/abc123');

    fetchMock.mock.restore();
  });

  it('respects MAX_REDIRECTS limit (5 hops)', async (t) => {
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['93.184.216.34']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });

    let callCount = 0;
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
      callCount++;
      // Always redirect — should stop after 5 hops
      return new Response(null, {
        status: 301,
        headers: { location: `https://example.com/hop-${callCount}` },
      });
    });

    const result = await expandUrl('https://t.co/abc123');
    // After 5 redirects, should return the last resolved URL
    assert.strictEqual(callCount, 5);
    assert.strictEqual(result, 'https://example.com/hop-5');

    fetchMock.mock.restore();
    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('resolves relative redirect locations against the current URL', async (t) => {
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['93.184.216.34']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });

    let callCount = 0;
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
      callCount++;
      if (callCount === 1) {
        // Return a relative redirect
        return new Response(null, {
          status: 301,
          headers: { location: '/final-page' },
        });
      }
      return new Response(null, { status: 200 });
    });

    const result = await expandUrl('https://example.com/start');
    assert.strictEqual(result, 'https://example.com/final-page');

    fetchMock.mock.restore();
    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('rejects redirect to file:// protocol', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
      return new Response(null, {
        status: 302,
        headers: { location: 'file:///etc/passwd' },
      });
    });

    const result = await expandUrl('https://t.co/abc123');
    // file:// is not https:, so it should return the current URL
    assert.strictEqual(result, 'https://t.co/abc123');

    fetchMock.mock.restore();
  });
});
