import type { Pool } from './db/connection.js';
import { bytesToVector } from './embed.js';
import type { Logger } from './logger.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface SearchResult {
  targetId: string;
  score: number; // cosine similarity
}

export interface VectorCache {
  load(): Promise<void>;
  search(query: Float32Array, type: 'summary' | 'report', limit?: number): Promise<SearchResult[]>;
  update(targetType: string, targetId: string, vector: Float32Array): void;
  prune(deletedIds: string[]): number;
  getSize(): { summaries: number; reports: number };
}

// ── Helpers ────────────────────────────────────────────────────────────

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Cache ──────────────────────────────────────────────────────────────

const SEARCHABLE_TYPES = ['summary', 'report'] as const;
type SearchableType = (typeof SEARCHABLE_TYPES)[number];

/** Maximum vectors per type map. At 768 dims x 4 bytes = ~3KB/vector, 20K = ~60MB per map. */
export const MAX_VECTORS = 20_000;

/**
 * Evict the oldest entries from a Map to stay within the size cap.
 * Maps in JS maintain insertion order, so the first entries are the oldest.
 */
export function evict(map: Map<string, Float32Array>, max: number): number {
  if (map.size <= max) return 0;
  const excess = map.size - max;
  const keysToDelete: string[] = [];
  const iter = map.keys();
  for (let i = 0; i < excess; i++) {
    const { value, done } = iter.next();
    if (done) break;
    keysToDelete.push(value as string);
  }
  for (const key of keysToDelete) {
    map.delete(key);
  }
  return keysToDelete.length;
}

export function createVectorCache(pool: Pool, log: Logger): VectorCache {
  const maps: Record<SearchableType, Map<string, Float32Array>> = {
    summary: new Map(),
    report: new Map(),
  };

  function getMap(type: string): Map<string, Float32Array> | undefined {
    if (type === 'summary' || type === 'report') {
      return maps[type];
    }
    return undefined;
  }

  async function loadType(type: SearchableType): Promise<number> {
    const result = await pool.query<{ target_id: string; vector: Buffer }>(
      'SELECT target_id, vector FROM embeddings WHERE target_type = $1 ORDER BY created_at ASC LIMIT $2',
      [type, MAX_VECTORS],
    );

    const map = maps[type];
    map.clear();

    let skipped = 0;
    for (const row of result.rows) {
      const vec = bytesToVector(row.vector);
      if (!vec) {
        skipped++;
        continue;
      }
      map.set(row.target_id, vec);
    }

    if (skipped > 0) {
      log.warn({ type, skipped }, 'vector-cache: skipped corrupt vectors (invalid byte length)');
    }

    return map.size;
  }

  async function load(): Promise<void> {
    const counts = await Promise.all(
      SEARCHABLE_TYPES.map(async (type) => {
        const count = await loadType(type);
        return { type, count };
      }),
    );

    for (const { type, count } of counts) {
      log.info({ type, count }, 'vector-cache: loaded vectors');
    }
  }

  const MIN_SIMILARITY = 0.3;

  /** Max vectors to scan from DB when falling back past the in-memory cache. */
  const DB_FALLBACK_BATCH = 500;

  async function search(query: Float32Array, type: 'summary' | 'report', limit = 10): Promise<SearchResult[]> {
    const map = maps[type];
    const results: SearchResult[] = [];

    for (const [targetId, vector] of map) {
      const score = cosineSimilarity(query, vector);
      if (score >= MIN_SIMILARITY) {
        results.push({ targetId, score });
      }
    }

    results.sort((a, b) => b.score - a.score);

    // If in-memory results already satisfy the limit, no DB fallback needed
    if (results.length >= limit) {
      return results.slice(0, limit);
    }

    // DB fallback: fetch recent vectors not already in the cache
    try {
      const cachedIds = [...map.keys()];
      const result = await pool.query<{ target_id: string; vector: Buffer }>(
        `SELECT target_id, vector FROM embeddings
         WHERE target_type = $1
           AND target_id != ALL($2::text[])
         ORDER BY created_at DESC
         LIMIT $3`,
        [type, cachedIds, DB_FALLBACK_BATCH],
      );

      for (const row of result.rows) {
        const vec = bytesToVector(row.vector);
        if (!vec) continue;
        const score = cosineSimilarity(query, vec);
        if (score >= MIN_SIMILARITY) {
          results.push({ targetId: row.target_id, score });
        }
      }

      results.sort((a, b) => b.score - a.score);
    } catch (err: unknown) {
      log.warn({ err, type }, 'vector-cache: DB fallback search failed, returning in-memory results only');
    }

    return results.slice(0, limit);
  }

  function update(targetType: string, targetId: string, vector: Float32Array): void {
    const map = getMap(targetType);
    if (map) {
      // Delete first so re-insertion moves to end (most recent position)
      map.delete(targetId);
      map.set(targetId, vector);

      const removed = evict(map, MAX_VECTORS);
      if (removed > 0) {
        log.debug({ type: targetType, removed }, 'vector-cache: evicted oldest entries');
      }
    }
  }

  function prune(deletedIds: string[]): number {
    let removed = 0;
    for (const id of deletedIds) {
      for (const type of SEARCHABLE_TYPES) {
        if (maps[type].delete(id)) {
          removed++;
        }
      }
    }
    return removed;
  }

  function getSize(): { summaries: number; reports: number } {
    return {
      summaries: maps.summary.size,
      reports: maps.report.size,
    };
  }

  return { load, search, update, prune, getSize };
}
