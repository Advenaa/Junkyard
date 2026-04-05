import { getRegionalDivergence } from '../db/queries.js';
import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';

// ── Types ────────────────────────────────────────────────────────────────

export type Direction = 'eng-bullish' | 'ind-bullish' | 'aligned';

export interface DivergenceEntry {
  entityId: string;
  entityName: string;
  engSentiment: number;
  engMentions: number;
  indSentiment: number;
  indMentions: number;
  divergence: number;
  direction: Direction;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Classify direction based on sentiment gap between English and Indonesian sources. */
function classifyDirection(engSentiment: number, indSentiment: number): Direction {
  const diff = engSentiment - indSentiment;
  if (diff >= 0.3) return 'eng-bullish';
  if (diff <= -0.3) return 'ind-bullish';
  return 'aligned';
}

// ── Tracker factory ──────────────────────────────────────────────────────

export function createDivergenceTracker(pool: Pool, log: Logger) {
  /**
   * Fetch entities where English and Indonesian sentiment diverge significantly.
   * Returns entries sorted by divergence (descending).
   */
  async function getDivergence(
    startTime: number,
    endTime: number,
    minMentions?: number,
  ): Promise<DivergenceEntry[]> {
    const rows = await getRegionalDivergence(pool, startTime, endTime, minMentions);

    const entries: DivergenceEntry[] = rows.map((row) => ({
      entityId: row.entity_id,
      entityName: row.entity_name,
      engSentiment: row.eng_sentiment,
      engMentions: row.eng_mentions,
      indSentiment: row.ind_sentiment,
      indMentions: row.ind_mentions,
      divergence: row.divergence,
      direction: classifyDirection(row.eng_sentiment, row.ind_sentiment),
    }));

    log.info(
      { startTime, endTime, count: entries.length },
      `Regional divergence: found ${entries.length} divergent entities`,
    );

    return entries;
  }

  return { getDivergence };
}
