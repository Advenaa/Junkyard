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
  let running = false;

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

    // Collect all successful embeddings for a single batch INSERT
    const now = Date.now();
    const rows: {
      id: string;
      targetType: string;
      targetId: string;
      model: string;
      dimensions: number;
      vector: Buffer;
    }[] = [];
    const cacheUpdates: { type: string; id: string; vector: Float32Array }[] = [];

    for (let i = 0; i < targets.length; i++) {
      const result = results[i];
      if (result === null) continue;

      const target = targets[i];
      rows.push({
        id: ulid(),
        targetType: target.type,
        targetId: target.id,
        model: result.model,
        dimensions: result.dimensions,
        vector: embedder.vectorToBytes(result.vector),
      });

      if (target.type === 'summary' || target.type === 'report') {
        cacheUpdates.push({ type: target.type, id: target.id, vector: result.vector });
      }
    }

    if (rows.length > 0) {
      // Build a single multi-row INSERT with parameterized placeholders
      const valueClauses: string[] = [];
      const params: unknown[] = [];
      for (let i = 0; i < rows.length; i++) {
        const offset = i * 7;
        valueClauses.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`,
        );
        const row = rows[i];
        params.push(row.id, row.targetType, row.targetId, row.model, row.dimensions, row.vector, now);
      }

      await pool.query(
        `INSERT INTO embeddings (id, target_type, target_id, model, dimensions, vector, created_at)
         VALUES ${valueClauses.join(', ')}
         ON CONFLICT(target_type, target_id) DO NOTHING`,
        params,
      );

      // Update vector cache after successful insert
      for (const update of cacheUpdates) {
        cache.update(update.type, update.id, update.vector);
      }
    }

    return rows.length;
  }

  async function run(): Promise<number> {
    if (running) {
      log.debug('embed-pipeline: already running, skipping');
      return 0;
    }
    running = true;
    try {
      if (!embedder.isAvailable()) return 0;

      // Note: items are NOT embedded — only summaries and reports are searchable via vector cache.
      // Embedding raw items would waste Gemini quota without adding search value.
      const [summaryRows, reportRows] = await Promise.all([
        fetchUnembedded('summary', 'summaries', 'body'),
        fetchUnembedded('report', 'reports', 'body'),
      ]);

      const targets: EmbedTarget[] = [
        ...summaryRows.map(r => ({ id: r.id, text: r.text, type: 'summary' as const })),
        ...reportRows.map(r => ({ id: r.id, text: r.text, type: 'report' as const })),
      ];

      if (targets.length === 0) {
        log.debug('embed-pipeline: nothing to embed');
        return 0;
      }

      log.info(
        { summaries: summaryRows.length, reports: reportRows.length },
        'embed-pipeline: embedding batch',
      );

      const count = await embedTargets(targets);

      log.info({ count }, 'embed-pipeline: batch complete');
      return count;
    } finally {
      running = false;
    }
  }

  return { run };
}
