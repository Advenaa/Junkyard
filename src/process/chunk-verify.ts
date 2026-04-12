import type { AuthorClaim, ChunkSummary } from './schemas.js';
import type { Logger } from '../logger.js';
import { normalizeAlias } from '../knowledge/entities.js';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasBoundaryMatch(rawText: string, candidate: string): boolean {
  const trimmed = candidate.trim();
  if (trimmed === '') return false;

  const pattern = new RegExp(`(?:^|[^A-Za-z0-9_])${escapeRegExp(trimmed)}(?=$|[^A-Za-z0-9_])`, 'i');
  return pattern.test(rawText);
}

export function verifyEntities(
  parsed: ChunkSummary,
  rawText: string,
  log: Logger,
  source: string,
  sourceId: string,
): ChunkSummary {
  const verified = parsed.entities.filter((entity) => {
    const found = [entity.name, ...entity.aliases].some((name) => hasBoundaryMatch(rawText, name));
    if (!found) {
      log.info({ entity: entity.name, source, sourceId }, 'Dropped entity not found in raw text');
    }
    return found;
  });
  return { ...parsed, entities: verified };
}

export function verifyEvents(parsed: ChunkSummary, log: Logger, source: string, sourceId: string): ChunkSummary {
  const validEntityKeys = new Set<string>();
  for (const entity of parsed.entities) {
    const canonical = normalizeAlias(entity.name);
    if (canonical) validEntityKeys.add(canonical);
    for (const alias of entity.aliases) {
      const normalizedAlias = normalizeAlias(alias);
      if (normalizedAlias) validEntityKeys.add(normalizedAlias);
    }
  }

  const verified = parsed.events.filter((event) => {
    const normalizedEntityName = normalizeAlias(event.entityName);
    const found = normalizedEntityName !== '' && validEntityKeys.has(normalizedEntityName);
    if (!found) {
      log.info(
        { eventType: event.eventType, entityName: event.entityName, source, sourceId },
        'Dropped event without verified entity match',
      );
    }
    return found;
  });

  return { ...parsed, events: verified };
}

export function verifyRelationships(parsed: ChunkSummary, log: Logger, source: string, sourceId: string): ChunkSummary {
  const validEntityKeys = new Set<string>();
  for (const entity of parsed.entities) {
    const canonical = normalizeAlias(entity.name);
    if (canonical) validEntityKeys.add(canonical);
    for (const alias of entity.aliases) {
      const normalizedAlias = normalizeAlias(alias);
      if (normalizedAlias) validEntityKeys.add(normalizedAlias);
    }
  }

  const seen = new Set<string>();
  const verified = parsed.relationships.filter((relationship) => {
    const entityNameA = normalizeAlias(relationship.entityNameA);
    const entityNameB = normalizeAlias(relationship.entityNameB);
    const valid =
      entityNameA !== '' &&
      entityNameB !== '' &&
      entityNameA !== entityNameB &&
      validEntityKeys.has(entityNameA) &&
      validEntityKeys.has(entityNameB);

    if (!valid) {
      log.info(
        {
          entityNameA: relationship.entityNameA,
          entityNameB: relationship.entityNameB,
          relationshipType: relationship.relationshipType,
          source,
          sourceId,
        },
        'Dropped relationship without verified distinct entity match',
      );
      return false;
    }

    const [canonA, canonB] = entityNameA < entityNameB ? [entityNameA, entityNameB] : [entityNameB, entityNameA];
    const dedupeKey = `${canonA}\0${canonB}\0${relationship.relationshipType}`;
    if (seen.has(dedupeKey)) {
      log.info(
        {
          entityNameA: relationship.entityNameA,
          entityNameB: relationship.entityNameB,
          relationshipType: relationship.relationshipType,
          source,
          sourceId,
        },
        'Dropped duplicate verified relationship',
      );
      return false;
    }

    seen.add(dedupeKey);
    return true;
  });

  return { ...parsed, relationships: verified };
}

export function verifyAuthorClaims<T extends { author: string }>(
  parsed: ChunkSummary,
  chunk: T[],
  log: Logger,
  source: string,
  sourceId: string,
): ChunkSummary {
  const validEntityKeys = new Set<string>();
  for (const entity of parsed.entities) {
    const canonical = normalizeAlias(entity.name);
    if (canonical) validEntityKeys.add(canonical);
    for (const alias of entity.aliases) {
      const normalizedAlias = normalizeAlias(alias);
      if (normalizedAlias) validEntityKeys.add(normalizedAlias);
    }
  }

  const chunkAuthors = new Set(chunk.map((item) => item.author.trim().toLowerCase()).filter(Boolean));

  const seen = new Set<string>();
  const verified: AuthorClaim[] = [];

  for (const claim of parsed.authorClaims) {
    const authorHandle = claim.authorHandle.trim().toLowerCase();
    const entityName = normalizeAlias(claim.entityName);
    const claimText = claim.claimText.trim();
    const valid =
      authorHandle !== '' &&
      claimText !== '' &&
      entityName !== '' &&
      chunkAuthors.has(authorHandle) &&
      validEntityKeys.has(entityName);

    if (!valid) {
      log.info(
        {
          authorHandle: claim.authorHandle,
          entityName: claim.entityName,
          claimType: claim.claimType,
          source,
          sourceId,
        },
        'Dropped author claim without verified author/entity match',
      );
      continue;
    }

    const dedupeKey = `${authorHandle}\0${entityName}\0${claim.claimType}\0${claimText.toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      log.info(
        {
          authorHandle: claim.authorHandle,
          entityName: claim.entityName,
          claimType: claim.claimType,
          source,
          sourceId,
        },
        'Dropped duplicate verified author claim',
      );
      continue;
    }

    seen.add(dedupeKey);
    verified.push({
      ...claim,
      authorHandle,
      claimText,
    });
  }

  return { ...parsed, authorClaims: verified };
}
