import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Config } from '../../src/config.js';
import type { Logger } from '../../src/logger.js';
import { createTwitterAdapter } from '../../src/ingest/twitter.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const mockPool = {
  query: async () => ({ rows: [] }),
} as any;

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    anthropicApiKey: 'test-key',
    geminiApiKey: 'test-gemini',
    databaseUrl: 'postgresql://localhost/test',
    discordClientId: null,
    discordClientSecret: null,
    adminUserIds: [],
    discordTokens: [],
    twitterApiKey: 'test-twitter-key',
    apiKey: 'test-api-key',
    sessionSecret: 'test-secret',
    port: 3000,
    dataDir: './data',
    publicUrl: null,
    alertWebhookUrl: null,
    models: { haiku: 'test-haiku', sonnet: 'test-sonnet' },
    secrets: [],
    ...overrides,
  };
}

function makeLogger(): Logger & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {};

  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      const name = String(prop);
      if (name === 'calls') return calls;
      if (!calls[name]) calls[name] = [];
      return (...args: unknown[]) => {
        calls[name]!.push(args);
      };
    },
  };

  return new Proxy({}, handler) as Logger & { calls: Record<string, unknown[][]> };
}

function makeTweet(overrides: Record<string, unknown> = {}) {
  return {
    id: '1234567890',
    text: 'Hello world from twitter',
    url: 'https://x.com/user/status/1234567890',
    likeCount: 10,
    retweetCount: 5,
    quoteCount: 2,
    createdAt: '2026-01-15T12:00:00Z',
    author: { userName: 'testuser', name: 'Test User' },
    ...overrides,
  };
}

function mockFetchResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Promise.resolve({
    status,
    headers: new Headers(headers),
    json: async () => body,
  } as Response);
}

let originalFetch: typeof globalThis.fetch;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Twitter adapter', () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -------------------------------------------------------------------------
  // tweetToRawItem transformation
  // -------------------------------------------------------------------------
  describe('tweetToRawItem transformation', () => {
    it('maps tweet JSON to RawItem fields correctly', async () => {
      const tweet = makeTweet();
      globalThis.fetch = () => mockFetchResponse({
        tweets: [tweet],
        has_next_page: false,
      });

      const adapter = createTwitterAdapter(makeConfig(), mockPool, makeLogger());
      const { items, lastId } = await adapter.poll('@testuser', null);

      assert.equal(items.length, 1);
      const item = items[0];
      assert.equal(item.source, 'twitter');
      assert.equal(item.sourceId, '@testuser');
      assert.equal(item.author, 'testuser');
      assert.equal(item.content, 'Hello world from twitter');
      assert.equal(item.timestamp, new Date('2026-01-15T12:00:00Z').getTime());
      assert.equal(item.url, 'https://x.com/user/status/1234567890');
      assert.ok(typeof item.id === 'string' && item.id.length > 0, 'should have a ULID id');
      assert.deepEqual(item.metadata, {
        tweetId: '1234567890',
        likes: 10,
        retweets: 5,
        replies: 0,
        quotes: 2,
        views: 0,
        bookmarks: 0,
        lang: undefined,
        isReply: undefined,
        isVerified: undefined,
        followers: undefined,
        authorId: undefined,
      });
      assert.equal(lastId, '1234567890');
    });

    it('handles tweet without optional url', async () => {
      const tweet = makeTweet({ url: undefined });
      globalThis.fetch = () => mockFetchResponse({
        tweets: [tweet],
        has_next_page: false,
      });

      const adapter = createTwitterAdapter(makeConfig(), mockPool, makeLogger());
      const { items } = await adapter.poll('@testuser', null);

      assert.equal(items[0].url, undefined);
    });
  });

  // -------------------------------------------------------------------------
  // Engagement score computation
  // -------------------------------------------------------------------------
  describe('engagement score computation', () => {
    async function getEngagement(likeCount: number, retweetCount: number, quoteCount: number): Promise<number> {
      const tweet = makeTweet({ likeCount, retweetCount, quoteCount });
      globalThis.fetch = () => mockFetchResponse({
        tweets: [tweet],
        has_next_page: false,
      });

      const adapter = createTwitterAdapter(makeConfig(), mockPool, makeLogger());
      const { items } = await adapter.poll('@testuser', null);
      return items[0].engagement;
    }

    it('computes engagement for zero counts', async () => {
      const score = await getEngagement(0, 0, 0);
      // raw=0, log10(max(1,0))=0, 0*20=0, clamped to 1
      assert.equal(score, 1);
    });

    it('computes engagement for small counts', async () => {
      const score = await getEngagement(5, 2, 1);
      // raw = 5 + 2*2 + 1*3 = 12, log10(12)~1.079, *20=21.58, round=22
      assert.equal(score, 22);
    });

    it('computes engagement for large counts', async () => {
      const score = await getEngagement(100000, 50000, 10000);
      // raw = 100000 + 100000 + 30000 = 230000, log10(230000)~5.36, *20=107.2, capped at 100
      assert.equal(score, 100);
    });

    it('computes engagement for moderate counts', async () => {
      const score = await getEngagement(10, 5, 2);
      // raw = 10 + 10 + 6 = 26, log10(26)~1.415, *20=28.3, round=28
      assert.equal(score, 28);
    });
  });

  // -------------------------------------------------------------------------
  // buildUrl (verified via fetch call inspection)
  // -------------------------------------------------------------------------
  describe('buildUrl via fetch inspection', () => {
    it('builds user timeline URL for @handle sourceId', async () => {
      let capturedUrl = '';
      globalThis.fetch = (input: any) => {
        capturedUrl = typeof input === 'string' ? input : input.url;
        return mockFetchResponse({ tweets: [], has_next_page: false });
      };

      const adapter = createTwitterAdapter(makeConfig(), mockPool, makeLogger());
      await adapter.poll('@elonmusk', null);

      assert.ok(capturedUrl.includes('/twitter/user/last_tweets'), 'should use user timeline endpoint');
      assert.ok(capturedUrl.includes('userName=elonmusk'), 'should strip @ and pass userName');
      assert.ok(capturedUrl.includes('includeReplies=false'), 'should exclude replies');
      assert.ok(!capturedUrl.includes('cursor'), 'should not include cursor on first page');
    });

    it('builds search URL for non-handle sourceId', async () => {
      let capturedUrl = '';
      globalThis.fetch = (input: any) => {
        capturedUrl = typeof input === 'string' ? input : input.url;
        return mockFetchResponse({ tweets: [], has_next_page: false });
      };

      const adapter = createTwitterAdapter(makeConfig(), mockPool, makeLogger());
      await adapter.poll('bitcoin pump', null);

      assert.ok(capturedUrl.includes('/twitter/tweet/advanced_search'), 'should use search endpoint');
      assert.ok(capturedUrl.includes('query=bitcoin+pump') || capturedUrl.includes('query=bitcoin%20pump'), 'should pass query param');
      assert.ok(capturedUrl.includes('queryType=Latest'), 'should use Latest query type');
    });
  });

  // -------------------------------------------------------------------------
  // poll returns items and lastId
  // -------------------------------------------------------------------------
  describe('poll returns items and lastId', () => {
    it('returns multiple items with newest tweet id as lastId', async () => {
      const tweets = [
        makeTweet({ id: '100', text: 'first tweet' }),
        makeTweet({ id: '300', text: 'third tweet' }),
        makeTweet({ id: '200', text: 'second tweet' }),
      ];
      globalThis.fetch = () => mockFetchResponse({
        tweets,
        has_next_page: false,
      });

      const adapter = createTwitterAdapter(makeConfig(), mockPool, makeLogger());
      const { items, lastId } = await adapter.poll('@testuser', null);

      assert.equal(items.length, 3);
      assert.equal(lastId, '300');
    });

    it('filters out already-seen tweets when lastId is provided', async () => {
      const tweets = [
        makeTweet({ id: '100', text: 'old tweet' }),
        makeTweet({ id: '200', text: 'also old' }),
        makeTweet({ id: '300', text: 'new tweet' }),
      ];
      globalThis.fetch = () => mockFetchResponse({
        tweets,
        has_next_page: false,
      });

      const adapter = createTwitterAdapter(makeConfig(), mockPool, makeLogger());
      const { items, lastId } = await adapter.poll('@testuser', '200');

      assert.equal(items.length, 1);
      assert.equal(items[0].content, 'new tweet');
      assert.equal(lastId, '300');
    });

    it('paginates through multiple pages', async () => {
      let callCount = 0;
      globalThis.fetch = () => {
        callCount++;
        if (callCount === 1) {
          return mockFetchResponse({
            tweets: [makeTweet({ id: '100', text: 'page 1' })],
            has_next_page: true,
            next_cursor: 'cursor_abc',
          });
        }
        return mockFetchResponse({
          tweets: [makeTweet({ id: '200', text: 'page 2' })],
          has_next_page: false,
        });
      };

      const adapter = createTwitterAdapter(makeConfig(), mockPool, makeLogger());
      const { items } = await adapter.poll('@testuser', null);

      assert.equal(callCount, 2);
      assert.equal(items.length, 2);
    });

    it('passes cursor to subsequent page requests', async () => {
      const capturedUrls: string[] = [];
      let callCount = 0;
      globalThis.fetch = (input: any) => {
        capturedUrls.push(typeof input === 'string' ? input : input.url);
        callCount++;
        if (callCount === 1) {
          return mockFetchResponse({
            tweets: [makeTweet({ id: '100' })],
            has_next_page: true,
            next_cursor: 'cursor_xyz',
          });
        }
        return mockFetchResponse({
          tweets: [makeTweet({ id: '200' })],
          has_next_page: false,
        });
      };

      const adapter = createTwitterAdapter(makeConfig(), mockPool, makeLogger());
      await adapter.poll('@testuser', null);

      assert.ok(!capturedUrls[0].includes('cursor'), 'first request should not have cursor');
      assert.ok(capturedUrls[1].includes('cursor=cursor_xyz'), 'second request should include cursor');
    });
  });

  // -------------------------------------------------------------------------
  // poll handles empty response
  // -------------------------------------------------------------------------
  describe('poll handles empty response', () => {
    it('returns empty items and null lastId when no tweets', async () => {
      globalThis.fetch = () => mockFetchResponse({
        tweets: [],
        has_next_page: false,
      });

      const adapter = createTwitterAdapter(makeConfig(), mockPool, makeLogger());
      const { items, lastId } = await adapter.poll('@testuser', null);

      assert.equal(items.length, 0);
      assert.equal(lastId, null);
    });

    it('returns empty when all tweets are older than lastId', async () => {
      const tweets = [
        makeTweet({ id: '100' }),
        makeTweet({ id: '200' }),
      ];
      globalThis.fetch = () => mockFetchResponse({
        tweets,
        has_next_page: false,
      });

      const adapter = createTwitterAdapter(makeConfig(), mockPool, makeLogger());
      const { items, lastId } = await adapter.poll('@testuser', '500');

      assert.equal(items.length, 0);
      assert.equal(lastId, '500');
    });

    it('returns empty when twitterApiKey is not set', async () => {
      const adapter = createTwitterAdapter(
        makeConfig({ twitterApiKey: null }),
        mockPool,
        makeLogger(),
      );
      const { items, lastId } = await adapter.poll('@testuser', null);

      assert.equal(items.length, 0);
      assert.equal(lastId, null);
    });
  });

  // -------------------------------------------------------------------------
  // poll respects 429 rate limiting
  // -------------------------------------------------------------------------
  describe('poll respects 429 rate limiting', () => {
    it('does not crash on 429 and returns empty', async () => {
      globalThis.fetch = () => mockFetchResponse(
        {},
        429,
        { 'retry-after': '60' },
      );

      const log = makeLogger();
      const adapter = createTwitterAdapter(makeConfig(), mockPool, log);
      const { items, lastId } = await adapter.poll('@testuser', null);

      assert.equal(items.length, 0);
      assert.equal(lastId, null);
      assert.ok(log.calls['warn']?.length > 0, 'should log a warning');
    });

    it('skips subsequent polls while rate limited', async () => {
      let fetchCalls = 0;
      globalThis.fetch = () => {
        fetchCalls++;
        return mockFetchResponse({}, 429, { 'retry-after': '300' });
      };

      const log = makeLogger();
      const adapter = createTwitterAdapter(makeConfig(), mockPool, log);

      // First call triggers the 429
      await adapter.poll('@testuser', null);
      assert.equal(fetchCalls, 1);

      // Second call should be skipped without hitting fetch
      const result = await adapter.poll('@testuser', null);
      assert.equal(fetchCalls, 1, 'should not make another fetch call');
      assert.equal(result.items.length, 0);
      assert.ok(log.calls['debug']?.some(
        (args) => JSON.stringify(args).includes('rate limit'),
      ), 'should log debug about rate limit backoff');
    });
  });

  // -------------------------------------------------------------------------
  // poll handles 401 (API key revoked)
  // -------------------------------------------------------------------------
  describe('poll handles 401 (API key revoked)', () => {
    /** Mock pool that tracks halted state via source_state writes */
    function makeHaltAwarePool() {
      let halted = false;
      return {
        query: async (sql: string) => {
          if (typeof sql === 'string' && sql.includes("status = 'halted'")) {
            halted = true;
            return { rows: [], rowCount: 1 };
          }
          if (typeof sql === 'string' && sql.includes('SELECT status')) {
            return { rows: halted ? [{ status: 'halted' }] : [] };
          }
          return { rows: [] };
        },
      } as any;
    }

    it('does not crash on 401 and returns empty', async () => {
      globalThis.fetch = () => mockFetchResponse({}, 401);

      const log = makeLogger();
      const adapter = createTwitterAdapter(makeConfig(), makeHaltAwarePool(), log);
      const { items, lastId } = await adapter.poll('@testuser', null);

      assert.equal(items.length, 0);
      assert.equal(lastId, null);
      assert.ok(log.calls['fatal']?.length > 0, 'should log fatal for invalid key');
    });

    it('halts all subsequent polls after 401', async () => {
      let fetchCalls = 0;
      globalThis.fetch = () => {
        fetchCalls++;
        return mockFetchResponse({}, 401);
      };

      const log = makeLogger();
      const adapter = createTwitterAdapter(makeConfig(), makeHaltAwarePool(), log);

      // First call triggers the halt
      await adapter.poll('@testuser', null);
      assert.equal(fetchCalls, 1);

      // Second call should be halted without hitting fetch (DB-backed halt)
      const result = await adapter.poll('@different_user', null);
      assert.equal(fetchCalls, 1, 'should not make another fetch call after halt');
      assert.equal(result.items.length, 0);
      assert.equal(result.lastId, null);
    });

    it('logs fatal only once for repeated 401s', async () => {
      globalThis.fetch = () => mockFetchResponse({}, 401);

      const log = makeLogger();
      const adapter = createTwitterAdapter(makeConfig(), makeHaltAwarePool(), log);

      await adapter.poll('@testuser', null);
      await adapter.poll('@testuser', null);

      assert.equal(log.calls['fatal']?.length, 1, 'should log fatal only once');
    });
  });
});
