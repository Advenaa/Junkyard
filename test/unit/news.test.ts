import dns from 'node:dns';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import type { Logger } from '../../src/logger.js';
import { createNewsAdapter } from '../../src/ingest/news.js';
import { _internal as urlValidatorInternal } from '../../src/url-validator.js';

const noopLog: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLog,
} as unknown as Logger;

function makeSpyLog() {
  const warnings: unknown[][] = [];
  const log: Logger = {
    info: () => {},
    warn: (...args: unknown[]) => {
      warnings.push(args);
    },
    error: () => {},
    debug: () => {},
    child: () => log,
  } as unknown as Logger;

  return { log, warnings };
}

describe('createNewsAdapter', () => {
  let originalFetch: typeof globalThis.fetch;
  let restoreDnsMocks = () => {};

  beforeEach(() => {
    originalFetch = urlValidatorInternal.fetch;
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
    urlValidatorInternal.fetch = originalFetch;
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
    urlValidatorInternal.fetch = (async () =>
      new Response('upstream error', { status: 503 })) as typeof globalThis.fetch;

    const adapter = createNewsAdapter(noopLog);
    const result = await adapter.extract('https://example.com/article');

    assert.equal(result.item, null);
    assert.equal(result.fetchFailed, true);
  });

  it('treats empty Readability output as a non-failure', async () => {
    urlValidatorInternal.fetch = (async () =>
      new Response('<html><head><title>Empty</title></head><body></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as typeof globalThis.fetch;

    const adapter = createNewsAdapter(noopLog);
    const result = await adapter.extract('https://example.com/article');

    assert.equal(result.item, null);
    assert.equal(result.fetchFailed, false);
  });

  it('treats oversized HTML bodies as a non-failure and logs a warning', async () => {
    urlValidatorInternal.fetch = (async () => {
      const body = new ReadableStream({
        start(controller) {
          const chunk = new Uint8Array(1024 * 1024);
          for (let i = 0; i < 6; i++) controller.enqueue(chunk);
          controller.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }) as typeof globalThis.fetch;

    const { log, warnings } = makeSpyLog();
    const adapter = createNewsAdapter(log);
    const result = await adapter.extract('https://example.com/article');

    assert.equal(result.item, null);
    assert.equal(result.fetchFailed, false);
    assert.equal(warnings.length, 1);
    assert.deepEqual(warnings[0], [
      { url: 'https://example.com/article' },
      'news: body exceeded size limit mid-stream',
    ]);
  });

  it('returns a RawItem when Readability extracts article content', async () => {
    urlValidatorInternal.fetch = (async () =>
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

  it('treats network errors as fetch failures', async () => {
    urlValidatorInternal.fetch = (async () => {
      throw new Error('socket hang up');
    }) as typeof globalThis.fetch;

    const adapter = createNewsAdapter(noopLog);
    const result = await adapter.extract('https://example.com/article');

    assert.equal(result.item, null);
    assert.equal(result.fetchFailed, true);
  });
});
