import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';

interface SourceRef {
  source: string;
  sourceId: string;
}

interface TrustManager {
  adjustAfterFlash(
    confirmedSources: SourceRef[],
    unconfirmedSources: SourceRef[],
  ): Promise<void>;
}

export function createTrustManager(pool: Pool, log: Logger): TrustManager {
  async function adjustSource(
    client: Pool,
    ref: SourceRef,
    confirmed: boolean,
  ): Promise<void> {
    const query = confirmed
      ? `UPDATE sources
           SET trust_weight = LEAST(initial_trust_weight + 0.2, trust_weight + 0.05)
         WHERE source = $1 AND source_id = $2
         RETURNING trust_weight`
      : `UPDATE sources
           SET trust_weight = GREATEST(initial_trust_weight - 0.2, trust_weight - 0.03)
         WHERE source = $1 AND source_id = $2
         RETURNING trust_weight`;

    const result = await client.query(query, [ref.source, ref.sourceId]);

    if (result.rows.length > 0) {
      const newWeight = result.rows[0].trust_weight as number;
      log.info(
        {
          source: ref.source,
          sourceId: ref.sourceId,
          confirmed,
          newTrustWeight: newWeight,
        },
        `Trust weight ${confirmed ? 'increased' : 'decreased'} for ${ref.source}/${ref.sourceId} -> ${newWeight}`,
      );
    } else {
      log.warn(
        { source: ref.source, sourceId: ref.sourceId },
        `Source not found for trust adjustment: ${ref.source}/${ref.sourceId}`,
      );
    }
  }

  return {
    async adjustAfterFlash(
      confirmedSources: SourceRef[],
      unconfirmedSources: SourceRef[],
    ): Promise<void> {
      for (const ref of confirmedSources) {
        await adjustSource(pool, ref, true);
      }

      for (const ref of unconfirmedSources) {
        await adjustSource(pool, ref, false);
      }

      log.info(
        {
          confirmed: confirmedSources.length,
          unconfirmed: unconfirmedSources.length,
        },
        `Trust adjustment complete: ${confirmedSources.length} confirmed, ${unconfirmedSources.length} unconfirmed`,
      );
    },
  };
}
