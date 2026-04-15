import { describe, it, mock, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createPriceFetcher } from '../../src/prices/coingecko.js';
import { makeMockLogger } from '../helpers/factories.js';

type FetchInput = string | URL | Request;

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function getFetchUrl(input: FetchInput): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function makeJsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function installFetch(
  t: TestContext,
  implementation: (input: FetchInput, init?: RequestInit) => Promise<Response>,
): { calls: FetchCall[]; fetchMock: ReturnType<typeof mock.fn> } {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];
  const fetchMock = mock.fn(async (input: FetchInput, init?: RequestInit) => {
    calls.push({ url: getFetchUrl(input), init });
    return implementation(input, init);
  });

  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  return { calls, fetchMock };
}

function installImmediateTimeout(t: TestContext): number[] {
  const delays: number[] = [];
  const setTimeoutMock = t.mock.method(globalThis, 'setTimeout', ((
    callback: (...args: unknown[]) => void,
    ms?: number,
  ) => {
    delays.push(ms ?? 0);
    callback();
    return 0;
  }) as typeof setTimeout);

  t.after(() => {
    setTimeoutMock.mock.restore();
  });

  return delays;
}

describe('createPriceFetcher', () => {
  it('parses a valid CoinGecko price response', async (t) => {
    const { calls } = installFetch(t, async () =>
      makeJsonResponse({
        bitcoin: {
          usd: 103_245.12,
          usd_24h_change: 4.25,
          usd_24h_vol: 5_500_000,
          usd_market_cap: 2_000_000_000,
        },
      }),
    );

    const fetcher = createPriceFetcher(makeMockLogger());
    const result = await fetcher.fetchPrices(['bitcoin']);

    assert.equal(calls.length, 1);
    assert.ok(calls[0]?.url.startsWith('https://api.coingecko.com/api/v3/simple/price?'));
    assert.deepEqual(result.get('bitcoin'), {
      priceUsd: 103_245.12,
      priceChange24h: 4.25,
      priceChange7d: null,
      volume24h: 5_500_000,
      marketCap: 2_000_000_000,
    });
  });

  it('returns only the tokens present in the CoinGecko response', async (t) => {
    installFetch(t, async () =>
      makeJsonResponse({
        bitcoin: {
          usd: 100_000,
        },
      }),
    );

    const fetcher = createPriceFetcher(makeMockLogger());
    const result = await fetcher.fetchPrices(['bitcoin', 'ethereum']);

    assert.equal(result.size, 1);
    assert.equal(result.has('bitcoin'), true);
    assert.equal(result.has('ethereum'), false);
  });

  it('logs and skips a chunk when CoinGecko returns 429', async (t) => {
    installFetch(t, async () => makeJsonResponse({ error: 'slow down' }, 429));

    const log = makeMockLogger();
    const warnMock = t.mock.method(log, 'warn', () => {});
    const fetcher = createPriceFetcher(log);
    const result = await fetcher.fetchPrices(['bitcoin']);

    assert.equal(result.size, 0);
    assert.equal(warnMock.mock.callCount(), 1);
    const warnArgs = warnMock.mock.calls[0]?.arguments ?? [];
    assert.match(String(warnArgs[1]), /CoinGecko price fetch failed/);
    assert.match(String(warnArgs[1]), /429/);
  });

  it('skips malformed price entries whose usd value is not numeric', async (t) => {
    installFetch(t, async () =>
      makeJsonResponse({
        bitcoin: {
          usd: '103245.12',
        },
        ethereum: {
          usd: 2_800,
          usd_24h_change: 1.2,
        },
      }),
    );

    const log = makeMockLogger();
    const warnMock = t.mock.method(log, 'warn', () => {});
    const fetcher = createPriceFetcher(log);
    const result = await fetcher.fetchPrices(['bitcoin', 'ethereum']);

    assert.equal(result.size, 1);
    assert.equal(result.has('bitcoin'), false);
    assert.deepEqual(result.get('ethereum'), {
      priceUsd: 2_800,
      priceChange24h: 1.2,
      priceChange7d: null,
      volume24h: null,
      marketCap: null,
    });
    assert.equal(warnMock.mock.callCount(), 1);
    const warnArgs = warnMock.mock.calls[0]?.arguments ?? [];
    assert.deepEqual(warnArgs[0], { coinId: 'bitcoin' });
  });

  it('returns an empty map without calling fetch for an empty id list', async (t) => {
    const { fetchMock } = installFetch(t, async () => makeJsonResponse({}));

    const fetcher = createPriceFetcher(makeMockLogger());
    const result = await fetcher.fetchPrices([]);

    assert.equal(result.size, 0);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('returns partial results when a later chunk fails with a network error', async (t) => {
    installImmediateTimeout(t);

    let callCount = 0;
    installFetch(t, async () => {
      callCount++;
      if (callCount === 1) {
        return makeJsonResponse({
          'coin-1': {
            usd: 1.23,
          },
        });
      }
      throw new Error('socket hang up');
    });

    const ids = Array.from({ length: 51 }, (_, index) => `coin-${index + 1}`);
    const log = makeMockLogger();
    const warnMock = t.mock.method(log, 'warn', () => {});
    const fetcher = createPriceFetcher(log);
    const result = await fetcher.fetchPrices(ids);

    assert.equal(callCount, 2);
    assert.equal(result.size, 1);
    assert.deepEqual(result.get('coin-1'), {
      priceUsd: 1.23,
      priceChange24h: null,
      priceChange7d: null,
      volume24h: null,
      marketCap: null,
    });
    assert.equal(warnMock.mock.callCount(), 1);
    assert.match(String(warnMock.mock.calls[0]?.arguments[1]), /socket hang up/);
  });

  it('deduplicates ids before building the CoinGecko request', async (t) => {
    const { calls } = installFetch(t, async () =>
      makeJsonResponse({
        bitcoin: { usd: 100_000 },
        ethereum: { usd: 2_500 },
      }),
    );

    const fetcher = createPriceFetcher(makeMockLogger());
    await fetcher.fetchPrices(['bitcoin', 'ethereum', 'bitcoin', 'ethereum']);

    assert.equal(calls.length, 1);
    const ids = new URL(calls[0]!.url).searchParams.get('ids')?.split(',') ?? [];
    assert.deepEqual(ids, ['bitcoin', 'ethereum']);
  });

  it('calls onAuthFailure when CoinGecko returns 401', async (t) => {
    const { calls } = installFetch(t, async () => makeJsonResponse({ error: 'unauthorized' }, 401));

    let authFailures = 0;
    const fetcher = createPriceFetcher(makeMockLogger(), 'pro-key', () => {
      authFailures++;
    });
    const result = await fetcher.fetchPrices(['bitcoin']);

    assert.equal(result.size, 0);
    assert.equal(authFailures, 1);
    assert.ok(calls[0]?.url.startsWith('https://pro-api.coingecko.com/api/v3/simple/price?'));
    assert.equal(calls[0]?.init?.headers instanceof Headers, false);
    assert.deepEqual(calls[0]?.init?.headers, {
      Accept: 'application/json',
      'x-cg-pro-api-key': 'pro-key',
    });
  });

  it('calls onAuthFailure when CoinGecko returns 403', async (t) => {
    installFetch(t, async () => makeJsonResponse({ error: 'forbidden' }, 403));

    let authFailures = 0;
    const fetcher = createPriceFetcher(makeMockLogger(), 'pro-key', () => {
      authFailures++;
    });
    const result = await fetcher.fetchPrices(['ethereum']);

    assert.equal(result.size, 0);
    assert.equal(authFailures, 1);
  });

  it('chunks requests larger than 50 ids into multiple fetches', async (t) => {
    const delays = installImmediateTimeout(t);
    const { calls } = installFetch(t, async () => makeJsonResponse({}));

    const ids = Array.from({ length: 51 }, (_, index) => `coin-${index + 1}`);
    const fetcher = createPriceFetcher(makeMockLogger());
    await fetcher.fetchPrices(ids);

    assert.equal(calls.length, 2);
    const firstChunkIds = new URL(calls[0]!.url).searchParams.get('ids')?.split(',') ?? [];
    const secondChunkIds = new URL(calls[1]!.url).searchParams.get('ids')?.split(',') ?? [];
    assert.equal(firstChunkIds.length, 50);
    assert.deepEqual(secondChunkIds, ['coin-51']);
    assert.deepEqual(delays, [2_000]);
  });
});
