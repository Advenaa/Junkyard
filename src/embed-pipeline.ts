import { ulid } from 'ulid';
import type { Pool } from './db/connection.js';
import type { Logger } from './logger.js';
import type { VectorCache } from './vector-cache.js';

// ── Types ──────────────────────────────────────────────────────────────

interface Embedder {
  isAvailable(): boolean;
  embedBatch(texts: string[]): Promise<({ vector: Float32Array; dimensions: number; model: string } | null)[]>;
  prepareText(text: string, type: 'item' | 'summary' | 'entity' | 'report'): string;
  vectorToBytes(vector: Float32Array): Buffer;
}

interface EmbedTarget {
  id: string;
  text: string;
  type: 'item' | 'summary' | 'report';
}

// ── Pipeline ──────────────────────────────────────────────────────────

export function createEmbedPipeline(pool: Pool, log: Logger, embedder: Embedder, cache: VectorCache) {
  async function fetchUnembedded(
    targetType: string,
    tableName: string,
    textColumn: string,
  ): Promise<{ id: string; text: string }[]> {
    const query = `
      SELECT t.id, t.${textColumn} AS text
      FROM ${tableName} t
      LEFT JOIN embeddings e ON e.target_type = $1 AND e.target_id = t.id
      WHERE e.id IS NULL
      ORDER BY t.created_at DESC
      LIMIT 100
    `;
    const result = await pool.query<{ id: string; text: string }>(query, [targetType]);
    return result.rows;
  }

  async function embedTargets(targets: EmbedTarget[]): Promise<number> {
    if (targets.length === 0) return 0;

    const prepared = targets.map(t => embedder.prepareText(t.text, t.type));
    const results = await embedder.embedBatch(prepared);

    let count = 0;

    for (let i = 0; i < targets.length; i++) {
      const result = results[i];
      if (result === null) continue;

      const target = targets[i];
      const now = Date.now();

      await pool.query(
        `INSERT INTO embeddings (id, target_type, target_id, model, dimensions, vector, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT(target_type, target_id) DO NOTHING`,
        [
          ulid(),
          target.type,
          target.id,
          result.model,
          result.dimensions,
          embedder.vectorToBytes(result.vector),
          now,
        ],
      );

      // Update vector cache for searchable types
      if (target.type === 'summary' || target.type === 'report') {
        cache.update(target.type, target.id, result.vector);
      }

      count++;
    }

    return count;
  }

  async function run(): Promise<number> {
    if (!embedder.isAvailable()) return 0;

    const [summaryRows, itemRows, reportRows] = await Promise.all([
      fetchUnembedded('summary', 'summaries', 'body'),
      fetchUnembedded('item', 'items', 'body'),
      fetchUnembedded('report', 'reports', 'body'),
    ]);

    const targets: EmbedTarget[] = [
      ...summaryRows.map(r => ({ id: r.id, text: r.text, type: 'summary' as const })),
      ...itemRows.map(r => ({ id: r.id, text: r.text, type: 'item' as const })),
      ...reportRows.map(r => ({ id: r.id, text: r.text, type: 'report' as const })),
    ];

    if (targets.length === 0) {
      log.debug('embed-pipeline: nothing to embed');
      return 0;
    }

    log.info(
      { summaries: summaryRows.length, items: itemRows.length, reports: reportRows.length },
      'embed-pipeline: embedding batch',
    );

    const count = await embedTargets(targets);

    log.info({ count }, 'embed-pipeline: batch complete');
    return count;
  }

  return { run };
}
