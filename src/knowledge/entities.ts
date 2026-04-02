import { ulid } from 'ulid';
import type { Config } from '../config.js';
import type { Pool } from '../db/connection.js';
import type { LLMCallParams, LLMCallResult } from '../llm.js';
import type { Logger } from '../logger.js';

export interface ExtractedEntity {
  name: string;
  aliases: string[];
  type: 'token' | 'person' | 'project' | 'company' | 'event';
  mentionCount: number;
  sentiment: number;
}

interface DisambiguatedEntity {
  name: string;
  type: 'token' | 'person' | 'project' | 'company' | 'event';
  context_key: string;
}

interface LLM {
  call(params: LLMCallParams): Promise<LLMCallResult>;
}

const SOURCE_WEIGHTS: Record<string, number> = {
  discord: 1.0,
  twitter: 1.5,
  news: 2.0,
  rss: 2.0,
};

interface EntityManager {
  resolveEntities(
    entities: ExtractedEntity[],
    source: string,
    summaryId: string,
  ): Promise<void>;
}

export function createEntityManager(
  pool: Pool,
  log: Logger,
  config: Config,
  llm: LLM,
): EntityManager {
  async function resolveEntities(
    entities: ExtractedEntity[],
    source: string,
    summaryId: string,
  ): Promise<void> {
    const now = Date.now();
    const resolvedIds: string[] = [];
    const unresolvedEntities: ExtractedEntity[] = [];
    const entityIdMap = new Map<ExtractedEntity, string>();

    // ── Tier 1: Alias lookup ────────────────────────────────────────────
    for (const entity of entities) {
      const canonical = entity.name.toLowerCase();

      const aliasResult = await pool.query<{ entity_id: string }>(
        'SELECT entity_id FROM entity_aliases WHERE alias = $1',
        [canonical],
      );

      if (aliasResult.rows.length > 0) {
        const entityId = aliasResult.rows[0].entity_id;
        resolvedIds.push(entityId);
        entityIdMap.set(entity, entityId);
        continue;
      }

      // Check archived
      const archivedResult = await pool.query<{ id: string }>(
        "SELECT id FROM entities WHERE name = $1 AND type = $2 AND status = 'archived'",
        [canonical, entity.type],
      );

      if (archivedResult.rows.length > 0) {
        const entityId = archivedResult.rows[0].id;
        await pool.query(
          "UPDATE entities SET status = 'active', relevance = 0.5 WHERE id = $1",
          [entityId],
        );
        log.info(
          { entityId, name: canonical },
          `Reactivated archived entity: ${canonical}`,
        );
        resolvedIds.push(entityId);
        entityIdMap.set(entity, entityId);
        continue;
      }

      // Not found in Tier 1
      unresolvedEntities.push(entity);
    }

    // ── Tier 2: Context-based disambiguation ────────────────────────────
    const stillUnresolved: ExtractedEntity[] = [];

    if (unresolvedEntities.length > 0 && resolvedIds.length > 0) {
      const coOccurring = await pool.query<{
        alias: string;
        entity_id: string;
      }>(
        `SELECT DISTINCT ea.alias, ea.entity_id
         FROM entity_aliases ea
         JOIN entity_mentions em ON em.entity_id = ea.entity_id
         WHERE em.summary_id IN (
           SELECT summary_id FROM entity_mentions WHERE entity_id = ANY($1)
         )`,
        [resolvedIds],
      );

      const coOccurMap = new Map<string, string>();
      for (const row of coOccurring.rows) {
        coOccurMap.set(row.alias, row.entity_id);
      }

      for (const entity of unresolvedEntities) {
        const canonical = entity.name.toLowerCase();
        const matched = coOccurMap.get(canonical);

        if (matched) {
          resolvedIds.push(matched);
          entityIdMap.set(entity, matched);
          log.info(
            { name: canonical, entityId: matched },
            `Tier 2 resolved: ${canonical}`,
          );
        } else {
          stillUnresolved.push(entity);
        }
      }
    } else {
      stillUnresolved.push(...unresolvedEntities);
    }

    // ── Tier 3: Batched Haiku disambiguation ────────────────────────────
    if (stillUnresolved.length > 0) {
      const entityNames = stillUnresolved.map((e) => ({
        name: e.name,
        aliases: e.aliases,
      }));

      try {
        const result = await llm.call({
          model: config.models.haiku,
          system:
            'You are resolving ambiguous entity names. For each entity, determine the most likely type and canonical name based on the context. Return JSON array: [{"name": "...", "type": "token|person|project|company|event", "context_key": "..."}]',
          messages: [
            {
              role: 'user',
              content: `Resolve these entities:\n${JSON.stringify(entityNames)}`,
            },
          ],
          maxTokens: 500,
          stage: 'entity-disambiguate',
        });

        const disambiguated = JSON.parse(result.content) as DisambiguatedEntity[];

        for (const item of disambiguated) {
          const matchedEntity = stillUnresolved.find(
            (e) => e.name.toLowerCase() === item.name.toLowerCase(),
          );
          if (!matchedEntity) continue;

          // Create new entity
          const newId = ulid();
          const canonical = item.name.toLowerCase();

          await pool.query(
            `INSERT INTO entities (id, name, type, status, relevance, first_seen, last_seen)
             VALUES ($1, $2, $3, 'active', 0, $4, $4)
             ON CONFLICT(name, type) DO NOTHING`,
            [newId, canonical, item.type, now],
          );

          const fetchResult = await pool.query<{ id: string }>(
            'SELECT id FROM entities WHERE name = $1 AND type = $2',
            [canonical, item.type],
          );

          const entityId = fetchResult.rows[0].id;
          resolvedIds.push(entityId);
          entityIdMap.set(matchedEntity, entityId);

          // Save context-aware alias for self-improving lookup
          await pool.query(
            `INSERT INTO entity_aliases (alias, context_key, entity_id)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
            [canonical, item.context_key, entityId],
          );

          log.info(
            { name: canonical, entityId, contextKey: item.context_key },
            `Tier 3 resolved: ${canonical}`,
          );
        }
      } catch (err) {
        log.error(
          { err, count: stillUnresolved.length },
          'Tier 3 disambiguation failed, creating entities with defaults',
        );

        // Fallback: create entities without LLM disambiguation
        for (const entity of stillUnresolved) {
          const canonical = entity.name.toLowerCase();
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

          const entityId = fetchResult.rows[0].id;
          entityIdMap.set(entity, entityId);

          await pool.query(
            `INSERT INTO entity_aliases (alias, context_key, entity_id)
             VALUES ($1, '', $2)
             ON CONFLICT DO NOTHING`,
            [canonical, entityId],
          );
        }
      }
    }

    // ── Insert aliases, update relevance, record mentions ───────────────
    const sourceWeight = SOURCE_WEIGHTS[source] ?? 1.0;

    for (const entity of entities) {
      const entityId = entityIdMap.get(entity);
      if (!entityId) continue;

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

      // Update relevance with source weight
      const relevanceDelta = Math.log(1 + entity.mentionCount) * sourceWeight;
      await pool.query(
        'UPDATE entities SET relevance = relevance + $1 WHERE id = $2',
        [relevanceDelta, entityId],
      );

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

  return {
    resolveEntities,
  };
}
