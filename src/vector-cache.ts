import type { Pool } from './db/connection.js';
import type { Logger } from './logger.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface SearchResult {
  targetId: string;
  score: number; // cosine similarity
}

export interface VectorCache {
  load(): Promise<void>;
  search(query: Float32Array, type: 'summary' | 'report' | 'entity', limit?: number): SearchResult[];
  update(targetType: string, targetId: string, vector: Float32Array): void;
  getSize(): { summaries: number; reports: number; entities: number };
}

// ── Helpers ────────────────────────────────────────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function bytesToVector(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

// ── Cache ──────────────────────────────────────────────────────────────

const SEARCHABLE_TYPES = ['summary', 'report', 'entity'] as const;
type SearchableType = typeof SEARCHABLE_TYPES[number];

export function createVectorCache(pool: Pool, log: Logger): VectorCache {
  const maps: Record<SearchableType, Map<string, Float32Array>> = {
    summary: new Map(),
    report: new Map(),
    entity: new Map(),
  };

  function getMap(type: string): Map<string, Float32Array> | undefined {
    if (type === 'summary' || type === 'report' || type === 'entity') {
      return maps[type];
    }
    return undefined;
  }

  async function loadType(type: SearchableType): Promise<number> {
    const result = await pool.query<{ target_id: string; vector: Buffer }>(
      'SELECT target_id, vector FROM embeddings WHERE target_type = $1',
      [type],
    );

    const map = maps[type];
    map.clear();

    for (const row of result.rows) {
      map.set(row.target_id, bytesToVector(row.vector));
    }

    return map.size;
  }

  async function load(): Promise<void> {
    const counts = await Promise.all(
      SEARCHABLE_TYPES.map(async type => {
        const count = await loadType(type);
        return { type, count };
      }),
    );

    for (const { type, count } of counts) {
      log.info({ type, count }, 'vector-cache: loaded vectors');
    }
  }

  function search(
    query: Float32Array,
    type: 'summary' | 'report' | 'entity',
    limit = 10,
  ): SearchResult[] {
    const map = maps[type];
    const results: SearchResult[] = [];

    for (const [targetId, vector] of map) {
      const score = cosineSimilarity(query, vector);
      results.push({ targetId, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  function update(targetType: string, targetId: string, vector: Float32Array): void {
    const map = getMap(targetType);
    if (map) {
      map.set(targetId, vector);
    }
  }

  function getSize(): { summaries: number; reports: number; entities: number } {
    return {
      summaries: maps.summary.size,
      reports: maps.report.size,
      entities: maps.entity.size,
    };
  }

  return { load, search, update, getSize };
}
