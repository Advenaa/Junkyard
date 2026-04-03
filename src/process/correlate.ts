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
  trust_weight: number;
}

interface UrgencyRow {
  urgency: string;
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
         )) AS mentions
  FROM entity_mentions em
  JOIN entities e ON e.id = em.entity_id
  WHERE em.created_at > $1
  GROUP BY em.entity_id, e.name
  HAVING COUNT(DISTINCT em.source) >= 2
`;

const TRUST_WEIGHT_SQL = `
  SELECT source, trust_weight FROM sources WHERE source = $1
`;

const URGENCY_SQL = `
  SELECT urgency FROM summaries WHERE id = $1
`;

// ── Factory ──────────────────────────────────────────────────────────

export function createCorrelator(pool: Pool, log: Logger) {
  async function getTrustWeight(source: string): Promise<number> {
    const { rows } = await pool.query<TrustRow>(TRUST_WEIGHT_SQL, [source]);
    if (rows.length === 0) {
      log.warn({ source }, 'No trust_weight found for source, defaulting to 0.5');
      return 0.5;
    }
    return rows[0].trust_weight;
  }

  async function getUrgency(summaryId: string): Promise<string> {
    const { rows } = await pool.query<UrgencyRow>(URGENCY_SQL, [summaryId]);
    if (rows.length === 0) {
      return 'routine';
    }
    return rows[0].urgency;
  }

  async function run(cutoff?: number): Promise<{ correlated: CorrelatedEntity[]; shouldFlash: boolean }> {
    const effectiveCutoff = cutoff ?? (Date.now() - 24 * 60 * 60 * 1000);

    const { rows } = await pool.query<MentionRow>(CORRELATION_SQL, [effectiveCutoff]);

    if (rows.length === 0) {
      log.info('No cross-source correlations found in last 24h');
      return { correlated: [], shouldFlash: false };
    }

    log.info({ entityCount: rows.length }, 'Found cross-source correlated entities');

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

      // Look up trust weights for each distinct source
      const sources: { source: string; sourceId: string; trustWeight: number }[] = [];
      let weightedSum = 0;

      for (const [source, { summaryIds }] of seenSources) {
        const trustWeight = await getTrustWeight(source);
        sources.push({
          source,
          sourceId: summaryIds[0], // representative summary id
          trustWeight,
        });
        weightedSum += trustWeight;
      }

      // Collect urgencies from all referenced summaries
      const allSummaryIds = row.mentions.map((m) => m.summary_id);
      const uniqueSummaryIds = [...new Set(allSummaryIds)];
      const urgencies: string[] = [];

      for (const summaryId of uniqueSummaryIds) {
        const urgency = await getUrgency(summaryId);
        urgencies.push(urgency);
      }

      const entityUrgency = highestUrgency(urgencies);

      const entity: CorrelatedEntity = {
        entityName: row.entity_name,
        sources,
        weightedSum,
        urgency: entityUrgency,
      };

      correlated.push(entity);

      // Flash trigger
      if (
        weightedSum >= 1.5 &&
        (entityUrgency === 'breaking' || entityUrgency === 'elevated')
      ) {
        shouldFlash = true;
        log.info(
          { entity: row.entity_name, weightedSum, urgency: entityUrgency },
          'Flash trigger activated',
        );
      }
    }

    log.info(
      { correlated: correlated.length, shouldFlash },
      'Correlation complete',
    );

    return { correlated, shouldFlash };
  }

  return { run };
}
