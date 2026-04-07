import type { Logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PriceData {
  priceUsd: number;
  priceChange24h: number | null;
  priceChange7d: number | null;
  volume24h: number | null;
  marketCap: number | null;
}

/** Shape returned by CoinGecko /simple/price for a single coin. */
interface CoinGeckoPrice {
  usd?: number;
  usd_24h_change?: number;
  usd_7d_change?: number;
  usd_24h_vol?: number;
  usd_market_cap?: number;
}

type CoinGeckoResponse = Record<string, CoinGeckoPrice>;

export interface PriceFetcher {
  fetchPrices(coingeckoIds: string[]): Promise<Map<string, PriceData>>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FREE_BASE_URL = 'https://api.coingecko.com/api/v3';
const PRO_BASE_URL = 'https://pro-api.coingecko.com/api/v3';
const CHUNK_SIZE = 50;
const CHUNK_DELAY_MS = 2_000;
const REQUEST_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNumber(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  return null;
}

function parseCoin(raw: CoinGeckoPrice): PriceData | null {
  const price = toNumber(raw.usd);
  if (price === null) return null;

  return {
    priceUsd: price,
    priceChange24h: toNumber(raw.usd_24h_change),
    priceChange7d: toNumber(raw.usd_7d_change),
    volume24h: toNumber(raw.usd_24h_vol),
    marketCap: toNumber(raw.usd_market_cap),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPriceFetcher(log: Logger, apiKey?: string): PriceFetcher {
  const baseUrl = apiKey ? PRO_BASE_URL : FREE_BASE_URL;

  async function fetchChunk(ids: string[]): Promise<Map<string, PriceData>> {
    const result = new Map<string, PriceData>();

    const params = new URLSearchParams({
      ids: ids.join(','),
      vs_currencies: 'usd',
      include_24hr_change: 'true',
      include_7d_change: 'true',
      include_24hr_vol: 'true',
      include_market_cap: 'true',
    });

    const url = `${baseUrl}/simple/price?${params.toString()}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (apiKey) {
      headers['x-cg-pro-api-key'] = apiKey;
    }

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`CoinGecko returned ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = (await response.json()) as CoinGeckoResponse;

    for (const [coinId, raw] of Object.entries(data)) {
      const parsed = parseCoin(raw);
      if (parsed) {
        result.set(coinId, parsed);
      } else {
        log.warn({ coinId }, 'CoinGecko returned invalid price data — skipping');
      }
    }

    return result;
  }

  async function fetchPrices(coingeckoIds: string[]): Promise<Map<string, PriceData>> {
    if (coingeckoIds.length === 0) {
      return new Map();
    }

    // Deduplicate IDs
    const unique = [...new Set(coingeckoIds)];

    // Split into chunks of CHUNK_SIZE
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
      chunks.push(unique.slice(i, i + CHUNK_SIZE));
    }

    const results = new Map<string, PriceData>();

    for (let i = 0; i < chunks.length; i++) {
      // Rate-limit: 2s delay between chunks (skip before first)
      if (i > 0) {
        await delay(CHUNK_DELAY_MS);
      }

      try {
        const chunkResult = await fetchChunk(chunks[i]);
        for (const [id, data] of chunkResult) {
          results.set(id, data);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(
          { err, chunkIndex: i, chunkSize: chunks[i].length },
          `CoinGecko price fetch failed for chunk ${i + 1}/${chunks.length}: ${message}`,
        );
        // Continue with remaining chunks — return partial results
      }
    }

    log.info(
      { requested: unique.length, fetched: results.size },
      `Fetched prices for ${results.size}/${unique.length} tokens`,
    );

    return results;
  }

  return { fetchPrices };
}
