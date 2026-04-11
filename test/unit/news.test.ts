import dns from 'node:dns';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import type { Logger } from '../../src/logger.js';
import { createNewsAdapter } from '../../src/ingest/news.js';

const noopLog: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLog,
} as unknown as Logger;

describe('createNewsAdapter', () => {
  let originalFetch: typeof globalThis.fetch;
  let restoreDnsMocks = () => {};

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    const resolve4Mock = mock.method(dns.promises, 'resolve4', async () => ['93.184.216.34']);
    const resolve6Mock = mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });
    restoreDnsMocks = () => {
      resolve4Mock.mock.restore();
      resolve6Mock.mock.restore();
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreDnsMocks();
    restoreDnsMocks = () => {};
  });

  it('treats SSRF validation rejections as fetch failures', async () => {
    const adapter = createNewsAdapter(noopLog);
    const result = await adapter.extract('https://127.0.0.1/article');

    assert.equal(result.item, null);
    assert.equal(result.fetchFailed, true);
  });

  it('treats non-2xx responses as fetch failures', async () => {
    globalThis.fetch = (async () => new Response('upstream error', { status: 503 })) as typeof globalThis.fetch;

    const adapter = createNewsAdapter(noopLog);
    const result = await adapter.extract('https://example.com/article');

    assert.equal(result.item, null);
    assert.equal(result.fetchFailed, true);
  });

  it('treats empty Readability output as a non-failure', async () => {
    globalThis.fetch = (async () =>
      new Response('<html><head><title>Empty</title></head><body></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as typeof globalThis.fetch;

    const adapter = createNewsAdapter(noopLog);
    const result = await adapter.extract('https://example.com/article');

    assert.equal(result.item, null);
    assert.equal(result.fetchFailed, false);
  });

  it('returns a RawItem when Readability extracts article content', async () => {
    globalThis.fetch = (async () =>
      new Response(
        `<!DOCTYPE html>
        <html>
          <head>
            <title>Markets Surge</title>
            <meta property="og:site_name" content="Example News" />
          </head>
          <body>
            <article>
              <h1>Markets Surge</h1>
              <p>Bitcoin climbed after a wave of ETF inflows hit the market.</p>
              <p>Ethereum followed as traders rotated into majors.</p>
            </article>
          </body>
        </html>`,
        {
          status: 200,
          headers: { 'content-type': 'text/html' },
        },
      )) as typeof globalThis.fetch;

    const adapter = createNewsAdapter(noopLog);
    const result = await adapter.extract('https://example.com/article');

    assert.equal(result.fetchFailed, false);
    assert.ok(result.item, 'expected a news item');
    assert.equal(result.item?.source, 'news');
    assert.equal(result.item?.sourceId, 'https://example.com/article');
    assert.equal(result.item?.url, 'https://example.com/article');
    assert.match(result.item?.content ?? '', /Bitcoin climbed/i);
  });
});
