import type { Pool } from '../db/connection.js';
import { upsertMacroSnapshots } from '../db/queries.js';
import type { Logger } from '../logger.js';
import { createFredMacroFetcher } from './fred.js';

export interface MacroTracker {
  fetchAndStore(): Promise<{ fetched: number; stored: number }>;
}

export function createMacroTracker(pool: Pool, log: Logger, apiKey?: string): MacroTracker {
  const fetcher = createFredMacroFetcher(log, apiKey);

  async function fetchAndStore(): Promise<{ fetched: number; stored: number }> {
    const snapshots = await fetcher.fetchLatest();
    if (snapshots.length === 0) {
      if (apiKey) {
        log.warn('FRED returned no macro snapshots — skipping storage');
      }
      return { fetched: 0, stored: 0 };
    }

    const stored = await upsertMacroSnapshots(pool, snapshots);

    log.info(
      { fetched: snapshots.length, stored },
      `Macro fetch complete: ${stored}/${snapshots.length} indicator snapshots stored`,
    );

    return { fetched: snapshots.length, stored };
  }

  return { fetchAndStore };
}
