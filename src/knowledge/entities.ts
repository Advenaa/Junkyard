import { ulid } from 'ulid';
import { z } from 'zod';
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

export const DisambiguatedEntitySchema = z.array(
  z.object({
    name: z.string(),
    type: z.enum(['token', 'person', 'project', 'company', 'event']),
    context_key: z.string(),
  }),
);

type DisambiguatedEntity = z.infer<typeof DisambiguatedEntitySchema>[number];

interface LLM {
  call(params: LLMCallParams): Promise<LLMCallResult>;
}

export const SOURCE_WEIGHTS: Record<string, number> = {
  discord: 1.0,
  twitter: 1.5,
  news: 2.0,
  rss: 2.0,
};

/** Normalize an alias: trim, lowercase, strip leading $.
 *  Returns empty string for inputs like "$" or whitespace — callers must check. */
export function normalizeAlias(alias: string): string {
  const result = alias.trim().toLowerCase().replace(/^\$/, '');
  return result;
}

interface EntityManager {
  resolveEntities(
    entities: ExtractedEntity[],
    source: string,
    summaryId: string,
    language?: string | null,
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
    language?: string | null,
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const now = Date.now();
      const resolvedIds: string[] = [];
      const unresolvedEntities: ExtractedEntity[] = [];
      const entityIdMap = new Map<ExtractedEntity, string>();

      // ── Tier 1: Alias lookup ────────────────────────────────────────────
      for (const entity of entities) {
        const canonical = normalizeAlias(entity.name);
        if (!canonical) {
          log.debug({ rawName: entity.name }, 'Entity name normalizes to empty, skipping');
          continue;
        }

        const aliasResult = await client.query<{ entity_id: string; status: string }>(
          `SELECT ea.entity_id, e.status FROM entity_aliases ea
           JOIN entities e ON e.id = ea.entity_id
           WHERE ea.alias = $1 AND e.type = $2
           ORDER BY ea.context_key = '' DESC, ea.context_key, ea.entity_id`,
          [canonical, entity.type],
        );

        if (aliasResult.rows.length > 0) {
          const row = aliasResult.rows[0];
          if (row.status === 'archived') {
            await client.query(
              `UPDATE entities SET status = 'active', relevance = 0.5 WHERE id = $1`,
              [row.entity_id],
            );
            log.info({ entityId: row.entity_id, alias: canonical }, 'reactivated archived entity via alias match');
          }
          resolvedIds.push(row.entity_id);
          entityIdMap.set(entity, row.entity_id);
          continue;
        }

        // Not found in Tier 1
        unresolvedEntities.push(entity);
      }

      // ── Tier 2: Context-based disambiguation ────────────────────────────
      const stillUnresolved: ExtractedEntity[] = [];

      if (unresolvedEntities.length > 0 && resolvedIds.length > 0) {
        const coOccurring = await client.query<{
          alias: string;
          entity_id: string;
          type: string;
        }>(
          `SELECT DISTINCT ea.alias, ea.entity_id, e.type
           FROM entity_aliases ea
           JOIN entity_mentions em ON em.entity_id = ea.entity_id
           JOIN entities e ON e.id = ea.entity_id
           WHERE em.summary_id IN (
             SELECT summary_id FROM entity_mentions WHERE entity_id = ANY($1)
           )
           AND e.status = 'active'`,
          [resolvedIds],
        );

        // Key by alias + type to avoid cross-type collisions
        const coOccurMap = new Map<string, string>();
        for (const row of coOccurring.rows) {
          coOccurMap.set(`${row.alias}\0${row.type}`, row.entity_id);
        }

        for (const entity of unresolvedEntities) {
          const canonical = normalizeAlias(entity.name);
          const matched = coOccurMap.get(`${canonical}\0${entity.type}`);

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

        let disambiguated: DisambiguatedEntity[] | undefined;

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

          let parsed: unknown;
          try {
            parsed = JSON.parse(result.content);
          } catch {
            log.warn(
              { content: result.content.slice(0, 200) },
              'Tier 3 disambiguation returned invalid JSON, falling back to defaults',
            );
          }

          if (parsed !== undefined) {
            const validation = DisambiguatedEntitySchema.safeParse(parsed);
            if (validation.success) {
              disambiguated = validation.data;
            } else {
              log.warn(
                { errors: validation.error.issues },
                'Tier 3 disambiguation failed zod validation, falling back to defaults',
              );
            }
          }
        } catch (err) {
          log.error(
            { err, count: stillUnresolved.length },
            'Tier 3 disambiguation failed, creating entities with defaults',
          );
        }

        if (disambiguated) {
          for (const item of disambiguated) {
            const matchedEntity = stillUnresolved.find(
              (e) => normalizeAlias(e.name) === normalizeAlias(item.name),
            );
            if (!matchedEntity) continue;

            // Create new entity
            const newId = ulid();
            const canonical = normalizeAlias(item.name);

            const upsertResult = await client.query<{ id: string }>(
              `INSERT INTO entities (id, name, type, status, relevance, first_seen, last_seen)
               VALUES ($1, $2, $3, 'active', 0, $4, $4)
               ON CONFLICT(name, type) DO UPDATE SET last_seen = $4
               RETURNING id`,
              [newId, canonical, item.type, now],
            );

            const entityId = upsertResult.rows[0].id;
            resolvedIds.push(entityId);
            entityIdMap.set(matchedEntity, entityId);

            // Save context-aware alias for self-improving lookup
            await client.query(
              `INSERT INTO entity_aliases (alias, context_key, entity_id)
               VALUES ($1, $2, $3)
               ON CONFLICT (alias, context_key) DO NOTHING`,
              [canonical, item.context_key, entityId],
            );

            log.info(
              { name: canonical, entityId, contextKey: item.context_key },
              `Tier 3 resolved: ${canonical}`,
            );
          }

          // Handle entities not returned by partial LLM response
          for (const entity of stillUnresolved) {
            if (entityIdMap.has(entity)) continue;

            const canonical = normalizeAlias(entity.name);
            const newId = ulid();

            const upsertResult = await client.query<{ id: string }>(
              `INSERT INTO entities (id, name, type, status, relevance, first_seen, last_seen)
               VALUES ($1, $2, $3, 'active', 0, $4, $4)
               ON CONFLICT(name, type) DO UPDATE SET last_seen = $4
               RETURNING id`,
              [newId, canonical, entity.type, now],
            );

            const entityId = upsertResult.rows[0].id;
            entityIdMap.set(entity, entityId);

            await client.query(
              `INSERT INTO entity_aliases (alias, context_key, entity_id)
               VALUES ($1, '', $2)
               ON CONFLICT (alias, context_key) DO NOTHING`,
              [canonical, entityId],
            );

            log.info(
              { name: canonical, entityId },
              `Tier 3 fallback (partial LLM response): ${canonical}`,
            );
          }
        } else {
          // Fallback: create entities without LLM disambiguation
          for (const entity of stillUnresolved) {
            const canonical = normalizeAlias(entity.name);
            const newId = ulid();

            const upsertResult = await client.query<{ id: string }>(
              `INSERT INTO entities (id, name, type, status, relevance, first_seen, last_seen)
               VALUES ($1, $2, $3, 'active', 0, $4, $4)
               ON CONFLICT(name, type) DO UPDATE SET last_seen = $4
               RETURNING id`,
              [newId, canonical, entity.type, now],
            );

            const entityId = upsertResult.rows[0].id;
            entityIdMap.set(entity, entityId);

            await client.query(
              `INSERT INTO entity_aliases (alias, context_key, entity_id)
               VALUES ($1, '', $2)
               ON CONFLICT (alias, context_key) DO NOTHING`,
              [canonical, entityId],
            );
          }
        }
      }

      // ── Batched: aliases, relevance+last_seen, mentions ────────────────
      const sourceWeight = SOURCE_WEIGHTS[source] ?? 1.0;

      // Collect all alias tuples for batch insert
      const aliasTuples: { alias: string; entityId: string }[] = [];
      // Collect entity IDs and relevance deltas for batch update
      const updateIds: string[] = [];
      const updateWeights: number[] = [];
      // Collect mention rows for batch insert
      const mentionRows: {
        id: string;
        entityId: string;
        sentiment: number;
        mentionCount: number;
      }[] = [];

      for (const entity of entities) {
        const entityId = entityIdMap.get(entity);
        if (!entityId) continue;

        for (const alias of entity.aliases) {
          const normalizedAlias = normalizeAlias(alias);
          if (!normalizedAlias) continue;
          aliasTuples.push({ alias: normalizedAlias, entityId });
        }

        updateIds.push(entityId);
        updateWeights.push(
          Math.log(1 + entity.mentionCount) * sourceWeight,
        );

        mentionRows.push({
          id: ulid(),
          entityId,
          sentiment: entity.sentiment,
          mentionCount: entity.mentionCount,
        });
      }

      // Batch alias INSERT (one multi-row query)
      if (aliasTuples.length > 0) {
        const aliasValues: string[] = [];
        const aliasParams: unknown[] = [];
        for (let i = 0; i < aliasTuples.length; i++) {
          const offset = i * 3;
          aliasValues.push(
            `($${offset + 1}, $${offset + 2}, $${offset + 3})`,
          );
          aliasParams.push(
            aliasTuples[i].alias,
            '',
            aliasTuples[i].entityId,
          );
        }
        await client.query(
          `INSERT INTO entity_aliases (alias, context_key, entity_id)
           VALUES ${aliasValues.join(', ')}
           ON CONFLICT (alias, context_key) DO NOTHING`,
          aliasParams,
        );
      }

      // Batch relevance + last_seen UPDATE (one query using unnest)
      if (updateIds.length > 0) {
        await client.query(
          `UPDATE entities
           SET relevance = entities.relevance + data.weight,
               last_seen = $1
           FROM (
             SELECT unnest($2::text[]) AS id,
                    unnest($3::real[]) AS weight
           ) data
           WHERE entities.id = data.id`,
          [now, updateIds, updateWeights],
        );
      }

      // Batch mention INSERT (one multi-row query)
      if (mentionRows.length > 0) {
        const mentionValues: string[] = [];
        const mentionParams: unknown[] = [];
        for (let i = 0; i < mentionRows.length; i++) {
          const offset = i * 8;
          mentionValues.push(
            `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`,
          );
          mentionParams.push(
            mentionRows[i].id,
            mentionRows[i].entityId,
            source,
            summaryId,
            mentionRows[i].sentiment,
            mentionRows[i].mentionCount,
            now,
            language ?? null,
          );
        }
        await client.query(
          `INSERT INTO entity_mentions (id, entity_id, source, summary_id, sentiment, mention_count, created_at, language)
           VALUES ${mentionValues.join(', ')}`,
          mentionParams,
        );
      }

      await client.query('COMMIT');

      log.info(
        { count: entities.length, source, summaryId },
        `Resolved ${entities.length} entities from ${source}`,
      );
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    resolveEntities,
  };
}
