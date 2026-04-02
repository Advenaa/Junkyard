import { ulid } from 'ulid';
import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';

export interface ExtractedEntity {
  name: string;
  aliases: string[];
  type: 'token' | 'person' | 'project' | 'company' | 'event';
  mentionCount: number;
  sentiment: number;
}

interface CoinGeckoEntry {
  id: string;
  symbol: string;
  name: string;
}

interface EntityManager {
  resolveEntities(
    entities: ExtractedEntity[],
    source: string,
    summaryId: string,
  ): Promise<void>;
  decayRelevance(): Promise<number>;
  seedFromCoinGecko(): Promise<number>;
}

export function createEntityManager(pool: Pool, log: Logger): EntityManager {
  async function resolveEntities(
    entities: ExtractedEntity[],
    source: string,
    summaryId: string,
  ): Promise<void> {
    const now = new Date().toISOString();

    for (const entity of entities) {
      const canonical = entity.name.toLowerCase();

      // Lookup alias
      const aliasResult = await pool.query<{ entity_id: string }>(
        'SELECT entity_id FROM entity_aliases WHERE alias = $1',
        [canonical],
      );

      let entityId: string;

      if (aliasResult.rows.length > 0) {
        entityId = aliasResult.rows[0].entity_id;
      } else {
        // Check archived
        const archivedResult = await pool.query<{ id: string }>(
          "SELECT id FROM entities WHERE name = $1 AND type = $2 AND status = 'archived'",
          [canonical, entity.type],
        );

        if (archivedResult.rows.length > 0) {
          entityId = archivedResult.rows[0].id;
          await pool.query(
            "UPDATE entities SET status = 'active', relevance = 0.5 WHERE id = $1",
            [entityId],
          );
          log.info(
            { entityId, name: canonical },
            `Reactivated archived entity: ${canonical}`,
          );
        } else {
          const newId = ulid();
          await pool.query(
            `INSERT INTO entities (id, name, type, status, relevance, first_seen, last_seen)
             VALUES ($1, $2, $3, 'active', 0, $4, $4)
             ON CONFLICT(name, type) DO NOTHING`,
            [newId, canonical, entity.type, now],
          );

          const fetchResult = await pool.query<{ id: string }>(
            'SELECT id FROM entities WHERE name = $1 AND type = $2',
            [canonical, entity.type],
          );

          entityId = fetchResult.rows[0].id;
        }

        // Insert canonical alias
        await pool.query(
          `INSERT INTO entity_aliases (alias, context_key, entity_id)
           VALUES ($1, '', $2)
           ON CONFLICT DO NOTHING`,
          [canonical, entityId],
        );
      }

      // Insert additional aliases
      for (const alias of entity.aliases) {
        const normalizedAlias = alias.toLowerCase().replace(/^\$/, '');
        await pool.query(
          `INSERT INTO entity_aliases (alias, context_key, entity_id)
           VALUES ($1, '', $2)
           ON CONFLICT DO NOTHING`,
          [normalizedAlias, entityId],
        );
      }

      // Update last_seen
      await pool.query('UPDATE entities SET last_seen = $1 WHERE id = $2', [
        now,
        entityId,
      ]);

      // Insert mention
      await pool.query(
        `INSERT INTO entity_mentions (id, entity_id, source, summary_id, sentiment, mention_count, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ulid(),
          entityId,
          source,
          summaryId,
          entity.sentiment,
          entity.mentionCount,
          now,
        ],
      );
    }

    log.info(
      { count: entities.length, source, summaryId },
      `Resolved ${entities.length} entities from ${source}`,
    );
  }

  async function decayRelevance(): Promise<number> {
    // Apply decay to all active entities
    await pool.query(
      "UPDATE entities SET relevance = relevance * 0.95 WHERE status = 'active'",
    );

    // Archive low-relevance entities not seen in 90 days
    const archiveResult = await pool.query<{ id: string }>(
      `UPDATE entities
       SET status = 'archived'
       WHERE status = 'active'
         AND relevance < 0.01
         AND last_seen < NOW() - INTERVAL '90 days'
       RETURNING id`,
    );

    const archivedCount = archiveResult.rowCount ?? 0;

    log.info(
      { archivedCount },
      `Decay complete: archived ${archivedCount} entities`,
    );

    return archivedCount;
  }

  async function seedFromCoinGecko(): Promise<number> {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/coins/list',
    );

    if (!response.ok) {
      log.error(
        { status: response.status },
        `CoinGecko API returned ${response.status}`,
      );
      return 0;
    }

    const coins = (await response.json()) as CoinGeckoEntry[];
    const now = new Date().toISOString();
    let seeded = 0;

    for (const coin of coins) {
      const newId = ulid();
      const name = coin.name.toLowerCase();

      const insertResult = await pool.query(
        `INSERT INTO entities (id, name, type, status, relevance, first_seen, last_seen)
         VALUES ($1, $2, 'token', 'active', 0, $3, $3)
         ON CONFLICT(name, type) DO NOTHING`,
        [newId, name, now],
      );

      if ((insertResult.rowCount ?? 0) === 0) {
        continue;
      }

      // Fetch the entity id (could be new or existing)
      const fetchResult = await pool.query<{ id: string }>(
        "SELECT id FROM entities WHERE name = $1 AND type = 'token'",
        [name],
      );

      const entityId = fetchResult.rows[0].id;

      // Insert 3 aliases: name, symbol, id
      const aliases = new Set([
        name,
        coin.symbol.toLowerCase(),
        coin.id.toLowerCase(),
      ]);

      for (const alias of aliases) {
        await pool.query(
          `INSERT INTO entity_aliases (alias, context_key, entity_id)
           VALUES ($1, '', $2)
           ON CONFLICT DO NOTHING`,
          [alias, entityId],
        );
      }

      seeded++;
    }

    log.info({ seeded }, `Seeded ${seeded} entities from CoinGecko`);

    return seeded;
  }

  return {
    resolveEntities,
    decayRelevance,
    seedFromCoinGecko,
  };
}
