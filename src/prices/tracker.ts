import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';
import { getActiveTokensWithCoinGeckoIds, insertPriceSnapshots } from '../db/queries.js';
import { createPriceFetcher } from './coingecko.js';

export interface PriceTracker {
  /** Fetch current prices for all active token entities and store snapshots. */
  fetchAndStore(): Promise<{ fetched: number; stored: number }>;
}

export function createPriceTracker(pool: Pool, log: Logger, apiKey?: string, onAuthFailure?: () => void): PriceTracker {
  const fetcher = createPriceFetcher(log, apiKey, onAuthFailure);

  async function fetchAndStore(): Promise<{ fetched: number; stored: number }> {
    const mappings = await getActiveTokensWithCoinGeckoIds(pool);
    if (mappings.length === 0) {
      log.info('No active token entities with CoinGecko IDs — skipping price fetch');
      return { fetched: 0, stored: 0 };
    }

    log.info({ tokenCount: mappings.length }, 'Fetching prices for active token entities');

    // Build coingeckoId → entityId lookup
    const idToEntity = new Map<string, string>();
    const coingeckoIds: string[] = [];
    for (const m of mappings) {
      idToEntity.set(m.coingeckoId, m.entityId);
      coingeckoIds.push(m.coingeckoId);
    }

    const prices = await fetcher.fetchPrices(coingeckoIds);
    if (prices.size === 0) {
      log.warn('CoinGecko returned no prices — skipping snapshot storage');
      return { fetched: 0, stored: 0 };
    }

    const now = Date.now();
    const snapshots = [];

    for (const [coingeckoId, priceData] of prices) {
      const entityId = idToEntity.get(coingeckoId);
      if (!entityId) continue;

      snapshots.push({
        entityId,
        timestamp: now,
        priceUsd: priceData.priceUsd,
        priceChange24h: priceData.priceChange24h,
        priceChange7d: priceData.priceChange7d,
        volume24h: priceData.volume24h,
        marketCap: priceData.marketCap,
        source: 'coingecko',
      });
    }

    const stored = await insertPriceSnapshots(pool, snapshots);

    log.info(
      { fetched: prices.size, stored, total: mappings.length },
      `Price fetch complete: ${stored}/${mappings.length} token snapshots stored`,
    );

    return { fetched: prices.size, stored };
  }

  return { fetchAndStore };
}
