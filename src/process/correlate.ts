import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';

// ── Types ────────────────────────────────────────────────────────────

export interface CorrelatedEntity {
  entityName: string;
  sources: { source: string; sourceId: string; trustWeight: number }[];
  weightedSum: number;
  urgency: string; // highest urgency across sources
}

interface MentionRow {
  entity_id: string;
  entity_name: string;
  mentions: {
    source: string;
    summary_id: string;
    sentiment: number;
  }[];
}

interface TrustRow {
  source: string;
  source_id: string;
  trust_weight: number;
}

type UrgencyLevel = 'breaking' | 'elevated' | 'routine';

const URGENCY_RANK: Record<UrgencyLevel, number> = {
  breaking: 3,
  elevated: 2,
  routine: 1,
};

// ── Helpers ──────────────────────────────────────────────────────────

function highestUrgency(levels: string[]): string {
  let max: UrgencyLevel = 'routine';
  for (const level of levels) {
    const rank = URGENCY_RANK[level as UrgencyLevel];
    if (rank !== undefined && rank > URGENCY_RANK[max]) {
      max = level as UrgencyLevel;
    }
  }
  return max;
}

// ── Queries ──────────────────────────────────────────────────────────

const CORRELATION_SQL = `
  SELECT em.entity_id, e.name AS entity_name,
         json_agg(json_build_object(
           'source', em.source,
           'summary_id', em.summary_id,
           'sentiment', em.sentiment
         ) ORDER BY em.created_at DESC) AS mentions
  FROM entity_mentions em
  JOIN entities e ON e.id = em.entity_id
  WHERE em.created_at >= $1
  GROUP BY em.entity_id, e.name
  HAVING COUNT(DISTINCT em.source) >= 2
`;

// ── Factory ──────────────────────────────────────────────────────────

export function createCorrelator(pool: Pool, log: Logger) {
  async function run(cutoff?: number): Promise<{ correlated: CorrelatedEntity[]; shouldFlash: boolean }> {
    const effectiveCutoff = cutoff ?? Date.now() - 24 * 60 * 60 * 1000;

    const { rows: rawRows } = await pool.query<MentionRow>(CORRELATION_SQL, [effectiveCutoff]);

    // CO-003: Runtime validation for json_agg — may be string if pg driver config changes
    const rows: MentionRow[] = [];
    for (const row of rawRows) {
      let mentions = row.mentions;
      if (typeof mentions === 'string') {
        try {
          mentions = JSON.parse(mentions) as MentionRow['mentions'];
        } catch {
          log.warn({ entityId: row.entity_id }, 'Skipping row: json_agg mentions is unparseable string');
          continue;
        }
      }
      if (!Array.isArray(mentions)) {
        log.warn({ entityId: row.entity_id }, 'Skipping row: json_agg mentions is not an array');
        continue;
      }
      rows.push({ ...row, mentions });
    }

    if (rows.length === 0) {
      log.info('No cross-source correlations found in last 24h');
      return { correlated: [], shouldFlash: false };
    }

    log.info({ entityCount: rows.length }, 'Found cross-source correlated entities');

    // Batch-fetch urgencies and source_ids from summaries (CR-003)
    const allSummaryIds = [...new Set(rows.flatMap((r) => r.mentions.map((m) => m.summary_id)))];
    const summaryMetaRows =
      allSummaryIds.length > 0
        ? (
            await pool.query<{ id: string; urgency: string; source_id: string; source: string }>(
              'SELECT id, urgency, source_id, source FROM summaries WHERE id = ANY($1)',
              [allSummaryIds],
            )
          ).rows
        : [];
    const urgencyMap = new Map(summaryMetaRows.map((r) => [r.id, r.urgency]));
    const sourceIdMap = new Map(summaryMetaRows.map((r) => [r.id, r.source_id]));

    // CO-001: Batch-fetch trust weights per (source, source_id) pair (CR-003 + CR-010: clamp to [0, 1])
    const sourcePairSet = new Set<string>();
    for (const meta of summaryMetaRows) {
      sourcePairSet.add(`${meta.source}:${meta.source_id}`);
    }
    const sourcePairs = [...sourcePairSet].map((key) => {
      const [source, ...rest] = key.split(':');
      return { source, source_id: rest.join(':') };
    });
    const trustRows =
      sourcePairs.length > 0
        ? (
            await pool.query<TrustRow>(
              `SELECT source, source_id, trust_weight FROM sources
           WHERE (source, source_id) IN (${sourcePairs.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ')})`,
              sourcePairs.flatMap((p) => [p.source, p.source_id]),
            )
          ).rows
        : [];
    const trustMap = new Map(
      trustRows.map((r) => [`${r.source}:${r.source_id}`, Math.max(0, Math.min(1, r.trust_weight))]),
    );

    const correlated: CorrelatedEntity[] = [];
    let shouldFlash = false;

    for (const row of rows) {
      // Deduplicate sources — each source counted once
      const seenSources = new Map<string, { summaryIds: string[] }>();
      for (const mention of row.mentions) {
        const existing = seenSources.get(mention.source);
        if (existing) {
          existing.summaryIds.push(mention.summary_id);
        } else {
          seenSources.set(mention.source, { summaryIds: [mention.summary_id] });
        }
      }

      // CO-001: Look up trust weights per (source, source_id) pair
      const sources: { source: string; sourceId: string; trustWeight: number }[] = [];
      let weightedSum = 0;

      for (const [source, { summaryIds }] of seenSources) {
        // CO-011: Collect ALL unique source_ids from the group and pick the highest trust weight
        const uniqueSourceIds = [...new Set(summaryIds.map((sid) => sourceIdMap.get(sid) ?? source))];
        let bestSourceId = uniqueSourceIds[0];
        let bestTrustWeight = -1;
        let anyFound = false;
        for (const sid of uniqueSourceIds) {
          const key = `${source}:${sid}`;
          const tw = trustMap.get(key);
          if (tw !== undefined) {
            anyFound = true;
            if (tw > bestTrustWeight) {
              bestTrustWeight = tw;
              bestSourceId = sid;
            }
          }
        }
        if (!anyFound) {
          bestTrustWeight = 0.5;
          log.warn(
            { source, sourceIds: uniqueSourceIds },
            'No trust_weight found for any source_id, defaulting to 0.5',
          );
        }
        sources.push({ source, sourceId: bestSourceId, trustWeight: bestTrustWeight });
        weightedSum += bestTrustWeight;
      }

      // Collect urgencies from all referenced summaries
      const uniqueSummaryIds = [...new Set(row.mentions.map((m) => m.summary_id))];
      const urgencies: string[] = uniqueSummaryIds.map((id) => urgencyMap.get(id) ?? 'routine');

      const entityUrgency = highestUrgency(urgencies);

      const entity: CorrelatedEntity = {
        entityName: row.entity_name,
        sources,
        weightedSum,
        urgency: entityUrgency,
      };

      correlated.push(entity);

      // Flash trigger
      if (weightedSum >= 2.0 && entityUrgency === 'breaking') {
        shouldFlash = true;
        log.info({ entity: row.entity_name, weightedSum, urgency: entityUrgency }, 'Flash trigger activated');
      }
    }

    log.info({ correlated: correlated.length, shouldFlash }, 'Correlation complete');

    return { correlated, shouldFlash };
  }

  return { run };
}
