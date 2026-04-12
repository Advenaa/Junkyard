import pg from 'pg';

import type {
  EventChainRow,
  EventRow,
  ReportChainDrilldownRow,
  SummaryEventWithChainRow,
  SummaryRow,
} from './types.js';

type Pool = pg.Pool;

export async function insertSummary(
  db: Pick<Pool, 'query'>,
  s: {
    id: string;
    source: string;
    sourceId: string;
    windowStart: number;
    windowEnd: number;
    body: string;
    sentiment: number | null;
    urgency: string | null;
    itemCount: number;
    createdAt: number;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO summaries (
      id, source, source_id, window_start, window_end,
      body, sentiment, urgency, item_count, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (id) DO NOTHING`,
    [s.id, s.source, s.sourceId, s.windowStart, s.windowEnd, s.body, s.sentiment, s.urgency, s.itemCount, s.createdAt],
  );
}

export async function getSummariesByTimeWindow(pool: Pool, start: number, end: number): Promise<SummaryRow[]> {
  const { rows } = await pool.query<SummaryRow>(
    `SELECT * FROM summaries WHERE created_at >= $1 AND created_at <= $2 ORDER BY created_at DESC LIMIT 200`,
    [start, end],
  );
  return rows;
}

export async function getSummaryById(pool: Pool, id: string): Promise<SummaryRow | null> {
  const { rows } = await pool.query<SummaryRow>(`SELECT * FROM summaries WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] ?? null;
}

export async function insertEvents(
  pool: Pool,
  events: Array<{
    id: string;
    entityId: string | null;
    entityName: string;
    eventType: EventRow['event_type'];
    description: string;
    eventTime: number;
    source: string;
    sourceId: string;
    summaryId: string;
    chainId?: string | null;
    createdAt: number;
  }>,
): Promise<void> {
  if (events.length === 0) return;

  const values: unknown[] = [];
  const rows = events.map((event, index) => {
    const offset = index * 11;
    values.push(
      event.id,
      event.entityId,
      event.entityName,
      event.eventType,
      event.description,
      event.eventTime,
      event.source,
      event.sourceId,
      event.summaryId,
      event.chainId ?? null,
      event.createdAt,
    );
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`;
  });

  await pool.query(
    `INSERT INTO events (
      id, entity_id, entity_name, event_type, description, event_time,
      source, source_id, summary_id, chain_id, created_at
    ) VALUES ${rows.join(', ')}
    ON CONFLICT (id) DO NOTHING`,
    values,
  );
}

export async function getMostRecentEventForEntity(
  pool: Pool,
  entityId: string,
  beforeTime: number,
  sinceTime: number,
): Promise<EventRow | null> {
  const { rows } = await pool.query<EventRow>(
    `SELECT id, entity_id, entity_name, event_type, description, event_time, source, source_id, summary_id, chain_id, created_at
       FROM events
      WHERE entity_id = $1
        AND event_time < $2
        AND event_time >= $3
      ORDER BY event_time DESC
      LIMIT 1`,
    [entityId, beforeTime, sinceTime],
  );
  return rows[0] ?? null;
}

export async function getRecentEventChains(
  pool: Pool,
  entityIds: string[],
  sinceTime: number,
  limit = 5,
): Promise<EventChainRow[]> {
  const { rows } = await pool.query<EventChainRow>(
    `SELECT COALESCE(chain_id, id) AS chain_root_id,
            MIN(entity_id) AS entity_id,
            MIN(entity_name) AS entity_name,
            COUNT(*)::int AS event_count,
            MIN(event_time) AS first_event_time,
            MAX(event_time) AS latest_event_time,
            ARRAY_AGG(event_type ORDER BY event_time ASC) AS event_types,
            ARRAY_AGG(description ORDER BY event_time ASC) AS descriptions
       FROM events
      WHERE entity_id = ANY($1::text[])
        AND event_time >= $2
      GROUP BY COALESCE(chain_id, id)
     HAVING COUNT(*) > 1
      ORDER BY MAX(event_time) DESC
      LIMIT $3`,
    [entityIds, sinceTime, limit],
  );
  return rows;
}

export async function getSummaryEventsWithChainContext(
  pool: Pool,
  summaryId: string,
): Promise<SummaryEventWithChainRow[]> {
  const { rows } = await pool.query<SummaryEventWithChainRow>(
    `WITH summary_events AS (
       SELECT e.*,
              COALESCE(e.chain_id, e.id) AS chain_root_id
         FROM events e
        WHERE e.summary_id = $1
     ),
     chain_events AS (
       SELECT e.id,
              e.summary_id,
              e.description,
              e.event_type,
              e.event_time,
              e.created_at,
              COALESCE(e.chain_id, e.id) AS chain_root_id
         FROM events e
        WHERE COALESCE(e.chain_id, e.id) IN (SELECT DISTINCT chain_root_id FROM summary_events)
     ),
     chain_stats AS (
       SELECT chain_root_id,
              COUNT(*)::int AS chain_event_count,
              MIN(event_time) AS chain_first_event_time,
              MAX(event_time) AS chain_latest_event_time,
              ARRAY_AGG(event_type ORDER BY event_time ASC, created_at ASC, id ASC) AS chain_event_types
         FROM chain_events
        GROUP BY chain_root_id
     ),
     chain_positions AS (
       SELECT id,
              ROW_NUMBER() OVER (
                PARTITION BY chain_root_id
                ORDER BY event_time ASC, created_at ASC, id ASC
              )::int AS chain_position
         FROM chain_events
     )
     SELECT se.id,
            se.entity_name,
            se.event_type,
            se.description,
            se.event_time,
            se.summary_id,
            se.chain_root_id,
            cs.chain_event_count,
            cs.chain_first_event_time,
            cs.chain_latest_event_time,
            cs.chain_event_types,
            cp.chain_position,
            prev.previous_summary_id,
            prev.previous_event_type,
            prev.previous_event_description,
            prev.previous_event_time,
            next.next_summary_id,
            next.next_event_type,
            next.next_event_description,
            next.next_event_time
       FROM summary_events se
       JOIN chain_stats cs ON cs.chain_root_id = se.chain_root_id
       JOIN chain_positions cp ON cp.id = se.id
       LEFT JOIN LATERAL (
         SELECT ce.summary_id AS previous_summary_id,
                ce.event_type AS previous_event_type,
                ce.description AS previous_event_description,
                ce.event_time AS previous_event_time
           FROM chain_events ce
          WHERE ce.chain_root_id = se.chain_root_id
            AND ce.summary_id <> se.summary_id
            AND (
              ce.event_time < se.event_time
              OR (ce.event_time = se.event_time AND ce.created_at < se.created_at)
              OR (ce.event_time = se.event_time AND ce.created_at = se.created_at AND ce.id < se.id)
            )
          ORDER BY ce.event_time DESC, ce.created_at DESC, ce.id DESC
          LIMIT 1
       ) prev ON true
       LEFT JOIN LATERAL (
         SELECT ce.summary_id AS next_summary_id,
                ce.event_type AS next_event_type,
                ce.description AS next_event_description,
                ce.event_time AS next_event_time
           FROM chain_events ce
          WHERE ce.chain_root_id = se.chain_root_id
            AND ce.summary_id <> se.summary_id
            AND (
              ce.event_time > se.event_time
              OR (ce.event_time = se.event_time AND ce.created_at > se.created_at)
              OR (ce.event_time = se.event_time AND ce.created_at = se.created_at AND ce.id > se.id)
            )
          ORDER BY ce.event_time ASC, ce.created_at ASC, ce.id ASC
          LIMIT 1
       ) next ON true
      ORDER BY se.event_time ASC, se.created_at ASC, se.id ASC`,
    [summaryId],
  );
  return rows;
}

export async function getRecentReportChainDrilldowns(
  pool: Pool,
  entityNames: string[],
  beforeTime: number,
  sinceTime: number,
  limit = 5,
): Promise<ReportChainDrilldownRow[]> {
  const normalizedNames = [
    ...new Set(entityNames.map((name) => name.trim().toLowerCase()).filter((name) => name.length > 0)),
  ];
  if (normalizedNames.length === 0) {
    return [];
  }

  const { rows } = await pool.query<ReportChainDrilldownRow>(
    `WITH matching_events AS (
       SELECT e.id,
              e.entity_name,
              e.event_type,
              e.description,
              e.event_time,
              e.summary_id,
              e.created_at,
              COALESCE(e.chain_id, e.id) AS chain_root_id
         FROM events e
        WHERE LOWER(e.entity_name) = ANY($1::text[])
          AND e.event_time <= $2
          AND e.event_time >= $3
     ),
     chain_stats AS (
       SELECT chain_root_id,
              MIN(entity_name) AS entity_name,
              COUNT(*)::int AS event_count,
              MIN(event_time) AS first_event_time,
              MAX(event_time) AS latest_event_time,
              ARRAY_AGG(event_type ORDER BY event_time ASC, created_at ASC, id ASC) AS event_types
         FROM matching_events
        GROUP BY chain_root_id
       HAVING COUNT(*) > 1
     ),
     latest_chain_events AS (
       SELECT chain_root_id,
              summary_id AS latest_summary_id,
              event_type AS latest_event_type,
              description AS latest_event_description,
              ROW_NUMBER() OVER (
                PARTITION BY chain_root_id
                ORDER BY event_time DESC, created_at DESC, id DESC
              )::int AS latest_rank
         FROM matching_events
     )
     SELECT cs.chain_root_id,
            cs.entity_name,
            cs.event_count,
            cs.first_event_time,
            cs.latest_event_time,
            cs.event_types,
            lce.latest_summary_id,
            lce.latest_event_type,
            lce.latest_event_description,
            COUNT(*) OVER ()::int AS total_chain_count
       FROM chain_stats cs
       JOIN latest_chain_events lce
         ON lce.chain_root_id = cs.chain_root_id
        AND lce.latest_rank = 1
      ORDER BY cs.latest_event_time DESC
      LIMIT $4`,
    [normalizedNames, beforeTime, sinceTime, limit],
  );
  return rows;
}
