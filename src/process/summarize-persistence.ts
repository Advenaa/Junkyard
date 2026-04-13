import { z } from 'zod';
import { ulid } from 'ulid';
import type { AuthorClaim, ChunkEvent, ChunkRelationship } from './schemas.js';
import { resolveEntityIds } from './resolve-entities.js';
import { budgetExhausted, type CallBudget } from './summarize-budget.js';
import { stripCodeFences } from './summarize.js';
import type { ClaimedItem, LLM } from './summarize.js';
import {
  insertEvents,
  insertAuthorCall,
  getMostRecentEventForEntity,
  upsertEntityRelationship,
  upsertAuthor,
} from '../db/queries.js';
import type { EntityRelationshipType, EventRow } from '../db/queries.js';
import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';
import type { Config } from '../config.js';
import { normalizeAlias } from '../knowledge/entities.js';

export const EVENT_CHAIN_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export const EventFollowUpSchema = z.object({
  followUp: z.boolean(),
});

export interface ChunkAuthorReference {
  authorId: string;
  sourceItemId: string;
  timestamp: number;
}

export function createPersistence(pool: Pool, log: Logger, llm: LLM, config: Config) {
  async function persistExtractedEvents(
    events: ChunkEvent[],
    source: string,
    sourceId: string,
    summaryId: string,
    eventTime: number,
    createdAt: number,
    callBudget: CallBudget,
  ): Promise<void> {
    if (events.length === 0) return;

    const normalizedEntityNames = [...new Set(events.map((event) => normalizeAlias(event.entityName)).filter(Boolean))];
    const entityIdByLookup = new Map<string, string>();

    if (normalizedEntityNames.length > 0) {
      const { rows } = await pool.query<{ id: string; canonical_name: string; alias: string | null }>(
        `SELECT e.id, LOWER(e.name) AS canonical_name, ea.alias
           FROM entities e
           LEFT JOIN entity_aliases ea ON ea.entity_id = e.id
          WHERE LOWER(e.name) = ANY($1) OR ea.alias = ANY($1)`,
        [normalizedEntityNames],
      );

      for (const row of rows) {
        entityIdByLookup.set(row.canonical_name, row.id);
        if (row.alias) {
          entityIdByLookup.set(row.alias, row.id);
        }
      }
    }

    async function shouldLinkAsFollowUp(event: ChunkEvent, priorEvent: EventRow): Promise<boolean> {
      if (budgetExhausted(callBudget, log)) return false;

      const classifierPrompt = `You decide whether a new entity event is a follow-up in the same ongoing chain as a prior event.

Return ONLY valid JSON:
{
  "followUp": true | false
}

Rules:
- true only when the new event clearly continues, reacts to, resolves, governs, audits, or follows from the prior event for the same entity.
- false when the new event is unrelated, a separate initiative, or too ambiguous to link safely.
- Be conservative.`;

      const classifierInput = JSON.stringify(
        {
          priorEvent: {
            entityName: priorEvent.entity_name,
            eventType: priorEvent.event_type,
            description: priorEvent.description,
            eventTime: priorEvent.event_time,
          },
          newEvent: {
            entityName: event.entityName,
            eventType: event.eventType,
            description: event.description,
            eventTime,
          },
        },
        null,
        2,
      );

      try {
        const wrapped = llm.wrapWithNonce(classifierInput);
        const result = await llm.call({
          model: config.models.normalizer,
          system: classifierPrompt,
          messages: [{ role: 'user', content: wrapped.wrapped }],
          maxTokens: 120,
          stage: 'event-link',
        });

        const parsed = JSON.parse(stripCodeFences(result.content)) as unknown;
        const validated = EventFollowUpSchema.safeParse(parsed);
        if (validated.success) {
          return validated.data.followUp;
        }
      } catch (err: unknown) {
        log.warn(
          { err, entityName: event.entityName, eventType: event.eventType, source, sourceId },
          'Event follow-up classification failed, leaving event unchained',
        );
      }

      return false;
    }

    await insertEvents(
      pool,
      await Promise.all(
        events.map(async (event) => {
          const normalizedEntityName = normalizeAlias(event.entityName);
          const entityId = entityIdByLookup.get(normalizedEntityName) ?? null;
          let chainId: string | null = null;

          if (entityId) {
            const priorEvent = await getMostRecentEventForEntity(
              pool,
              entityId,
              eventTime,
              eventTime - EVENT_CHAIN_LOOKBACK_MS,
            );

            if (priorEvent && (await shouldLinkAsFollowUp(event, priorEvent))) {
              chainId = priorEvent.chain_id ?? priorEvent.id;
            }
          }

          return {
            id: ulid(),
            entityId,
            entityName: event.entityName,
            eventType: event.eventType,
            description: event.description,
            eventTime,
            source,
            sourceId,
            summaryId,
            chainId,
            createdAt,
          };
        }),
      ),
    );
  }

  async function persistExtractedRelationships(relationships: ChunkRelationship[], summaryId: string): Promise<void> {
    if (relationships.length === 0) return;

    const exactNames = [
      ...new Set(
        relationships
          .flatMap((relationship) => [relationship.entityNameA, relationship.entityNameB])
          .map(normalizeAlias),
      ),
    ].filter(Boolean);
    const entityIdByLookup = await resolveEntityIds(pool, exactNames);

    for (const relationship of relationships) {
      const entityIdA = entityIdByLookup.get(normalizeAlias(relationship.entityNameA));
      const entityIdB = entityIdByLookup.get(normalizeAlias(relationship.entityNameB));

      if (!entityIdA || !entityIdB || entityIdA === entityIdB) {
        log.info(
          {
            entityNameA: relationship.entityNameA,
            entityNameB: relationship.entityNameB,
            relationshipType: relationship.relationshipType,
            source: 'llm_inferred',
          },
          'Skipping inferred relationship without resolved distinct entity IDs',
        );
        continue;
      }

      await upsertEntityRelationship(
        pool,
        entityIdA,
        entityIdB,
        relationship.relationshipType as EntityRelationshipType,
        relationship.confidence,
        'llm_inferred',
        summaryId,
      );
    }
  }

  async function persistAuthorClaims(
    authorClaims: AuthorClaim[],
    chunkAuthors: Map<string, ChunkAuthorReference>,
  ): Promise<void> {
    if (authorClaims.length === 0 || chunkAuthors.size === 0) return;

    const exactNames = [...new Set(authorClaims.map((claim) => normalizeAlias(claim.entityName)).filter(Boolean))];
    const entityIdByLookup = await resolveEntityIds(pool, exactNames);

    for (const claim of authorClaims) {
      const author = chunkAuthors.get(claim.authorHandle);
      const entityId = entityIdByLookup.get(normalizeAlias(claim.entityName));

      if (!author || !entityId) {
        log.info(
          {
            authorHandle: claim.authorHandle,
            entityName: claim.entityName,
            claimType: claim.claimType,
          },
          'Skipping author claim without resolved author/entity IDs',
        );
        continue;
      }

      await insertAuthorCall(pool, {
        authorId: author.authorId,
        entityId,
        claimType: claim.claimType,
        claimText: claim.claimText,
        confidence: claim.confidence,
        sourceItemId: author.sourceItemId,
        timestamp: author.timestamp,
      });
    }
  }

  async function loadChunkAuthors(
    chunk: ClaimedItem[],
    source: string,
    sourceId: string,
    batchId: string,
  ): Promise<Map<string, ChunkAuthorReference>> {
    const chunkAuthors = new Map<string, ChunkAuthorReference>();

    try {
      const authorsSeen = new Map<string, { sourceItemId: string; timestamp: number }>();
      for (const item of chunk) {
        const handle = item.author?.trim().toLowerCase();
        if (!handle) continue;

        const previous = authorsSeen.get(handle);
        if (previous === undefined || item.timestamp > previous.timestamp) {
          authorsSeen.set(handle, { sourceItemId: item.id, timestamp: item.timestamp });
        }
      }

      if (authorsSeen.size === 0) {
        return chunkAuthors;
      }

      const upsertedAuthors = await Promise.all(
        [...authorsSeen.entries()].map(async ([handle, { sourceItemId, timestamp }]) => {
          const author = await upsertAuthor(pool, source, handle, null, timestamp);
          return [handle, { authorId: author.id, sourceItemId, timestamp }] as const;
        }),
      );

      for (const [handle, author] of upsertedAuthors) {
        chunkAuthors.set(handle, author);
      }
    } catch (authorErr: unknown) {
      log.warn({ err: authorErr, source, sourceId, batchId }, 'Author upsert failed for chunk, continuing');
    }

    return chunkAuthors;
  }

  return { persistExtractedEvents, persistExtractedRelationships, persistAuthorClaims, loadChunkAuthors };
}
