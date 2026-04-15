import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';
import { getActiveTokensWithCoinGeckoIds, insertPriceSnapshots } from '../db/queries.js';
import { createPriceFetcher } from './coingecko.js';

interface HistoricalPriceRow {
  entity_id: string;
  price_usd: string | number;
}

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

    const entityIds = snapshots.map((snapshot) => snapshot.entityId);
    if (entityIds.length > 0) {
      const sevenDayUpperBound = now - 6.5 * 86_400_000;
      const sevenDayLowerBound = now - 8 * 86_400_000;
      const { rows } = await pool.query<HistoricalPriceRow>(
        `SELECT DISTINCT ON (entity_id) entity_id, price_usd
           FROM price_snapshots
          WHERE entity_id = ANY($1)
            AND timestamp <= $2
            AND timestamp >= $3
          ORDER BY entity_id, timestamp DESC`,
        [entityIds, sevenDayUpperBound, sevenDayLowerBound],
      );

      const priorPrices = new Map(rows.map((row) => [row.entity_id, Number(row.price_usd)]));
      for (const snapshot of snapshots) {
        const priorPrice = priorPrices.get(snapshot.entityId);
        if (priorPrice == null || !Number.isFinite(priorPrice) || priorPrice === 0) {
          continue;
        }

        snapshot.priceChange7d = ((snapshot.priceUsd - priorPrice) / priorPrice) * 100;
      }
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
