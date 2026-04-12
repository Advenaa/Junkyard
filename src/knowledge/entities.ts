import { ulid } from 'ulid';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Pool, PoolClient } from '../db/connection.js';
import type { LLMCallParams, LLMCallResult } from '../llm.js';
import type { Logger } from '../logger.js';

export interface ExtractedEntity {
  name: string;
  aliases: string[];
  type: 'token' | 'person' | 'project' | 'company' | 'event';
  mentionCount: number;
  sentiment: number;
}

export interface ResolvedEntity {
  entityId: string;
  disambiguationFailed?: boolean;
}

export const DisambiguatedEntitySchema = z.array(
  z.object({
    name: z.string(),
    type: z.enum(['token', 'person', 'project', 'company', 'event']),
    context_key: z.string(),
  }),
);

type DisambiguatedEntity = z.infer<typeof DisambiguatedEntitySchema>[number];

export type Tier3DisambiguationFallbackReason =
  | 'invalid-json'
  | 'zod-validation'
  | 'llm-exception'
  | 'partial-response';

export interface Tier3DisambiguationFallbackStats {
  totalCount: number;
  byReason: Record<Tier3DisambiguationFallbackReason, number>;
}

function createEmptyTier3DisambiguationFallbackStats(): Tier3DisambiguationFallbackStats {
  return {
    totalCount: 0,
    byReason: {
      'invalid-json': 0,
      'zod-validation': 0,
      'llm-exception': 0,
      'partial-response': 0,
    },
  };
}

let tier3DisambiguationFallbackStats = createEmptyTier3DisambiguationFallbackStats();

export function resetTier3DisambiguationFallbackStats(): void {
  tier3DisambiguationFallbackStats = createEmptyTier3DisambiguationFallbackStats();
}

export function getTier3DisambiguationFallbackStats(): Tier3DisambiguationFallbackStats {
  return {
    totalCount: tier3DisambiguationFallbackStats.totalCount,
    byReason: { ...tier3DisambiguationFallbackStats.byReason },
  };
}

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

export interface EntityManager {
  resolveEntities(
    entities: ExtractedEntity[],
    source: string,
    summaryId: string,
    language?: string | null,
    client?: PoolClient,
  ): Promise<string[]>;
  resolveEntitiesDetailed(
    entities: ExtractedEntity[],
    source: string,
    summaryId: string,
    language?: string | null,
    client?: PoolClient,
  ): Promise<ResolvedEntity[]>;
}

function recordTier3DisambiguationFallback(
  log: Logger,
  reason: Tier3DisambiguationFallbackReason,
  entities: readonly ExtractedEntity[],
  metadata: Record<string, unknown>,
): void {
  if (entities.length === 0) {
    return;
  }

  tier3DisambiguationFallbackStats.totalCount += entities.length;
  tier3DisambiguationFallbackStats.byReason[reason] += entities.length;

  log.warn(
    {
      ...metadata,
      reason,
      entityNames: entities.map((entity) => entity.name),
      fallbackCount: entities.length,
      totalFallbackCount: tier3DisambiguationFallbackStats.totalCount,
    },
    'Tier 3 disambiguation fell back to default entity types',
  );
}

export function createEntityManager(pool: Pool, log: Logger, config: Config, llm: LLM): EntityManager {
  async function resolveEntitiesDetailed(
    entities: ExtractedEntity[],
    source: string,
    summaryId: string,
    language?: string | null,
    clientOverride?: PoolClient,
  ): Promise<ResolvedEntity[]> {
    const client = clientOverride ?? (await pool.connect());
    const ownsTransaction = clientOverride == null;
    try {
      if (ownsTransaction) {
        await client.query('BEGIN');
      }

      const now = Date.now();
      const resolvedIds: string[] = [];
      const unresolvedEntities: ExtractedEntity[] = [];
      const entityIdMap = new Map<ExtractedEntity, string>();
      const resolvedEntitiesById = new Map<string, ResolvedEntity>();
      const reactivatedEntities = new Set<ExtractedEntity>();

      const rememberResolvedEntity = (
        entity: ExtractedEntity,
        entityId: string,
        options?: { disambiguationFailed?: boolean },
      ): void => {
        entityIdMap.set(entity, entityId);

        const existing = resolvedEntitiesById.get(entityId);
        if (existing) {
          if (options?.disambiguationFailed) {
            existing.disambiguationFailed = true;
          }
          return;
        }

        resolvedEntitiesById.set(
          entityId,
          options?.disambiguationFailed ? { entityId, disambiguationFailed: true } : { entityId },
        );
      };

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
              `UPDATE entities SET status = 'active', relevance = GREATEST(relevance, 0.5) WHERE id = $1`,
              [row.entity_id],
            );
            await client.query(
              `INSERT INTO entity_mentions (id, entity_id, source, summary_id, sentiment, mention_count, created_at, language)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [ulid(), row.entity_id, source, summaryId, entity.sentiment, entity.mentionCount, now, language ?? null],
            );
            reactivatedEntities.add(entity);
            log.info({ entityId: row.entity_id, alias: canonical }, 'reactivated archived entity via alias match');
          }
          resolvedIds.push(row.entity_id);
          rememberResolvedEntity(entity, row.entity_id);
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
          status: string;
        }>(
          `SELECT DISTINCT ea.alias, ea.entity_id, e.type, e.status
           FROM entity_aliases ea
           JOIN entity_mentions em ON em.entity_id = ea.entity_id
           JOIN entities e ON e.id = ea.entity_id
           WHERE em.summary_id IN (
             SELECT summary_id FROM entity_mentions WHERE entity_id = ANY($1)
           )`,
          [resolvedIds],
        );

        // Key by alias + type to avoid cross-type collisions
        const coOccurMap = new Map<string, { entityId: string; status: string }>();
        for (const row of coOccurring.rows) {
          coOccurMap.set(`${row.alias}\0${row.type}`, { entityId: row.entity_id, status: row.status });
        }

        for (const entity of unresolvedEntities) {
          const canonical = normalizeAlias(entity.name);
          const match = coOccurMap.get(`${canonical}\0${entity.type}`);

          if (match) {
            if (match.status === 'archived') {
              await client.query(
                `UPDATE entities SET status = 'active', relevance = GREATEST(relevance, 0.5) WHERE id = $1`,
                [match.entityId],
              );
              await client.query(
                `INSERT INTO entity_mentions (id, entity_id, source, summary_id, sentiment, mention_count, created_at, language)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                  ulid(),
                  match.entityId,
                  source,
                  summaryId,
                  entity.sentiment,
                  entity.mentionCount,
                  now,
                  language ?? null,
                ],
              );
              reactivatedEntities.add(entity);
              log.info(
                { entityId: match.entityId, alias: canonical },
                'reactivated archived entity via Tier 2 co-occurrence',
              );
            }
            resolvedIds.push(match.entityId);
            rememberResolvedEntity(entity, match.entityId);
            log.info({ name: canonical, entityId: match.entityId }, `Tier 2 resolved: ${canonical}`);
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
        let fallbackReason: Tier3DisambiguationFallbackReason | undefined;
        const tier3FallbackEntities: ExtractedEntity[] = [];
        const recordBatchFallback = (
          reason: Tier3DisambiguationFallbackReason,
          fallbackEntities: readonly ExtractedEntity[],
          metadata: Record<string, unknown> = {},
        ): void => {
          if (fallbackEntities.length === 0) {
            return;
          }
          tier3FallbackEntities.push(...fallbackEntities);
          recordTier3DisambiguationFallback(log, reason, fallbackEntities, {
            source,
            summaryId,
            batchSize: stillUnresolved.length,
            ...metadata,
          });
        };

        try {
          const result = await llm.call({
            model: config.models.normalizer,
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
            fallbackReason = 'invalid-json';
            recordBatchFallback(fallbackReason, stillUnresolved, { content: result.content.slice(0, 200) });
          }

          if (parsed !== undefined) {
            const validation = DisambiguatedEntitySchema.safeParse(parsed);
            if (validation.success) {
              disambiguated = validation.data;
            } else {
              fallbackReason = 'zod-validation';
              recordBatchFallback(fallbackReason, stillUnresolved, { errors: validation.error.issues });
            }
          }
        } catch (err) {
          fallbackReason = 'llm-exception';
          recordBatchFallback(fallbackReason, stillUnresolved, { err });
        }

        if (disambiguated) {
          for (const item of disambiguated) {
            const matchedEntity = stillUnresolved.find((e) => normalizeAlias(e.name) === normalizeAlias(item.name));
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
            rememberResolvedEntity(matchedEntity, entityId);

            // Save context-aware alias for self-improving lookup
            await client.query(
              `INSERT INTO entity_aliases (id, entity_id, alias, context_key, origin, created_at)
               VALUES ($1, $2, $3, $4, 'llm', $5)
               ON CONFLICT (alias, context_key) DO NOTHING`,
              [ulid(), entityId, canonical, item.context_key, now],
            );

            log.info({ name: canonical, entityId, contextKey: item.context_key }, `Tier 3 resolved: ${canonical}`);
          }

          // Handle entities not returned by partial LLM response
          const partialFallbackEntities = stillUnresolved.filter((entity) => !entityIdMap.has(entity));
          recordBatchFallback('partial-response', partialFallbackEntities);

          for (const entity of partialFallbackEntities) {
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
            rememberResolvedEntity(entity, entityId, { disambiguationFailed: true });

            await client.query(
              `INSERT INTO entity_aliases (id, entity_id, alias, context_key, origin, created_at)
               VALUES ($1, $2, $3, '', 'llm', $4)
               ON CONFLICT (alias, context_key) DO NOTHING`,
              [ulid(), entityId, canonical, now],
            );

            log.info({ name: canonical, entityId }, `Tier 3 fallback (partial LLM response): ${canonical}`);
          }
        } else {
          // Fallback: create entities without LLM disambiguation
          if (tier3FallbackEntities.length === 0) {
            recordBatchFallback(fallbackReason ?? 'llm-exception', stillUnresolved);
          }

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
            rememberResolvedEntity(entity, entityId, { disambiguationFailed: true });

            await client.query(
              `INSERT INTO entity_aliases (id, entity_id, alias, context_key, origin, created_at)
               VALUES ($1, $2, $3, '', 'llm', $4)
               ON CONFLICT (alias, context_key) DO NOTHING`,
              [ulid(), entityId, canonical, now],
            );
          }
        }

        const fallbackRate = stillUnresolved.length === 0 ? 0 : tier3FallbackEntities.length / stillUnresolved.length;
        if (fallbackRate > 0.5) {
          log.warn(
            {
              source,
              summaryId,
              batchSize: stillUnresolved.length,
              fallbackCount: tier3FallbackEntities.length,
              fallbackRate,
              fallbackEntityNames: tier3FallbackEntities.map((entity) => entity.name),
            },
            'Tier 3 disambiguation fallback rate exceeded 50% of batch',
          );
        }
      }

      // ── Batched: aliases, relevance+last_seen, mentions ────────────────
      const sourceWeight = SOURCE_WEIGHTS[source] ?? 1.0;

      // Collect all alias tuples for batch insert
      const aliasTuples: { alias: string; entityId: string }[] = [];
      // Collect mention rows for batch insert
      const mentionRows: {
        id: string;
        entityId: string;
        sentiment: number;
        mentionCount: number;
      }[] = [];
      // Aggregate weights by entity_id before the batch UPDATE so duplicate
      // ExtractedEntity entries that normalize to the same canonical (e.g. "BTC"
      // and "btc") don't trigger undefined UPDATE … FROM join behavior that
      // silently drops one weight delta.
      const weightById = new Map<string, number>();

      for (const entity of entities) {
        const entityId = entityIdMap.get(entity);
        if (!entityId) continue;

        for (const alias of entity.aliases) {
          const normalizedAlias = normalizeAlias(alias);
          if (!normalizedAlias) continue;
          aliasTuples.push({ alias: normalizedAlias, entityId });
        }

        const weight = Math.log(1 + entity.mentionCount) * sourceWeight;
        weightById.set(entityId, (weightById.get(entityId) ?? 0) + weight);

        if (reactivatedEntities.has(entity)) {
          continue;
        }

        mentionRows.push({
          id: ulid(),
          entityId,
          sentiment: entity.sentiment,
          mentionCount: entity.mentionCount,
        });
      }

      // Rebuild updateIds / updateWeights from the deduped map.
      const updateIds = [...weightById.keys()];
      const updateWeights = [...weightById.values()];

      // Batch alias INSERT (one multi-row query)
      if (aliasTuples.length > 0) {
        const aliasValues: string[] = [];
        const aliasParams: unknown[] = [];
        for (let i = 0; i < aliasTuples.length; i++) {
          const offset = i * 6;
          aliasValues.push(
            `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`,
          );
          aliasParams.push(ulid(), aliasTuples[i].entityId, aliasTuples[i].alias, '', 'llm', now);
        }
        await client.query(
          `INSERT INTO entity_aliases (id, entity_id, alias, context_key, origin, created_at)
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

      if (ownsTransaction) {
        await client.query('COMMIT');
      }

      if (entities.length > 0 && resolvedEntitiesById.size === 0) {
        log.warn(
          {
            inputNames: entities.map((entity) => entity.name),
            reason: 'all_filtered_or_failed',
            source,
            summaryId,
          },
          'Entity resolution returned zero results from non-empty input',
        );
      }

      log.info({ count: entities.length, source, summaryId }, `Resolved ${entities.length} entities from ${source}`);

      return [...resolvedEntitiesById.values()];
    } catch (err) {
      if (ownsTransaction) {
        await client.query('ROLLBACK').catch(() => {});
      }
      throw err;
    } finally {
      if (ownsTransaction) {
        client.release();
      }
    }
  }

  async function resolveEntities(
    entities: ExtractedEntity[],
    source: string,
    summaryId: string,
    language?: string | null,
    clientOverride?: PoolClient,
  ): Promise<string[]> {
    const resolvedEntities = await resolveEntitiesDetailed(entities, source, summaryId, language, clientOverride);
    return resolvedEntities.map((entity) => entity.entityId);
  }

  return {
    resolveEntities,
    resolveEntitiesDetailed,
  };
}
