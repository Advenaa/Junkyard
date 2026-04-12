import pg from 'pg';
import { ulid } from 'ulid';

import type {
  EntityRelationshipGraphRow,
  EntityRelationshipRow,
  EntityRelationshipSource,
  EntityRelationshipType,
} from './types.js';

type Pool = pg.Pool;

const ENTITY_RELATIONSHIP_SELECT = `SELECT
       er.id,
       er.entity_id_a AS "entityIdA",
       ea.name AS "entityNameA",
       er.entity_id_b AS "entityIdB",
       eb.name AS "entityNameB",
       er.relationship_type AS "relationshipType",
       er.confidence,
       er.source,
       er.summary_id AS "summaryId",
       er.since_at AS "sinceAt",
       er.until_at AS "untilAt",
       er.created_at AS "createdAt",
       er.updated_at AS "updatedAt"
     FROM entity_relationships er
     JOIN entities ea ON ea.id = er.entity_id_a
     JOIN entities eb ON eb.id = er.entity_id_b`;

export async function getEntityRelationships(pool: Pool, entityId: string): Promise<EntityRelationshipRow[]> {
  const { rows } = await pool.query<EntityRelationshipRow>(
    `${ENTITY_RELATIONSHIP_SELECT}
      WHERE er.entity_id_a = $1
         OR er.entity_id_b = $1
      ORDER BY er.updated_at DESC, er.created_at DESC`,
    [entityId],
  );
  return rows;
}

export async function getCompetitors(pool: Pool, entityId: string): Promise<EntityRelationshipRow[]> {
  const { rows } = await pool.query<EntityRelationshipRow>(
    `${ENTITY_RELATIONSHIP_SELECT}
      WHERE (er.entity_id_a = $1 OR er.entity_id_b = $1)
        AND er.relationship_type = 'competes_with'
      ORDER BY er.updated_at DESC, er.created_at DESC`,
    [entityId],
  );
  return rows;
}

async function getEntityRelationshipGraphRoot(
  pool: Pool,
  entityId: string,
): Promise<{ id: string; name: string } | null> {
  const { rows } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name
       FROM entities
      WHERE id = $1`,
    [entityId],
  );
  return rows[0] ?? null;
}

async function getEntityRelationshipBatch(pool: Pool, entityIds: readonly string[]): Promise<EntityRelationshipRow[]> {
  if (entityIds.length === 0) return [];

  const { rows } = await pool.query<EntityRelationshipRow>(
    `${ENTITY_RELATIONSHIP_SELECT}
      WHERE er.entity_id_a = ANY($1::text[])
         OR er.entity_id_b = ANY($1::text[])
      ORDER BY er.updated_at DESC, er.confidence DESC, er.created_at DESC`,
    [entityIds],
  );
  return rows;
}

export async function getEntityRelationshipGraph(
  pool: Pool,
  rootEntityId: string,
  depth = 2,
  nodeLimit = 18,
): Promise<EntityRelationshipGraphRow | null> {
  const root = await getEntityRelationshipGraphRoot(pool, rootEntityId);
  if (!root) return null;

  const boundedDepth = Math.max(1, Math.min(depth, 2));
  const boundedNodeLimit = Math.max(1, Math.min(nodeLimit, 24));
  const nodeDepths = new Map<string, number>([[root.id, 0]]);
  const nodeNames = new Map<string, string>([[root.id, root.name]]);
  const relationshipMap = new Map<string, EntityRelationshipRow>();
  let frontier = new Set<string>([root.id]);

  for (let currentDepth = 0; currentDepth < boundedDepth && frontier.size > 0; currentDepth += 1) {
    const frontierIds = Array.from(frontier);
    const frontierSet = new Set(frontierIds);
    frontier = new Set<string>();

    const rows = await getEntityRelationshipBatch(pool, frontierIds);
    for (const row of rows) {
      nodeNames.set(row.entityIdA, row.entityNameA);
      nodeNames.set(row.entityIdB, row.entityNameB);

      let shouldIncludeRelationship = nodeDepths.has(row.entityIdA) && nodeDepths.has(row.entityIdB);

      const candidateExpansions = [
        { fromId: row.entityIdA, toId: row.entityIdB },
        { fromId: row.entityIdB, toId: row.entityIdA },
      ];

      for (const expansion of candidateExpansions) {
        if (!frontierSet.has(expansion.fromId)) continue;
        const fromDepth = nodeDepths.get(expansion.fromId);
        if (fromDepth == null || fromDepth >= boundedDepth) continue;

        const nextDepth = fromDepth + 1;
        if (nextDepth > boundedDepth) continue;

        const existingDepth = nodeDepths.get(expansion.toId);
        if (existingDepth == null) {
          if (nodeDepths.size >= boundedNodeLimit) continue;
          nodeDepths.set(expansion.toId, nextDepth);
          frontier.add(expansion.toId);
        }

        shouldIncludeRelationship = true;
      }

      if (shouldIncludeRelationship) {
        relationshipMap.set(row.id, row);
      }
    }
  }

  const includedNodeIds = new Set(nodeDepths.keys());
  const relationships = Array.from(relationshipMap.values()).filter(
    (relationship) => includedNodeIds.has(relationship.entityIdA) && includedNodeIds.has(relationship.entityIdB),
  );

  const nodes = Array.from(nodeDepths.entries())
    .map(([id, discoveredDepth]) => ({
      id,
      name: nodeNames.get(id) ?? id,
      depth: discoveredDepth,
      isRoot: id === root.id,
    }))
    .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));

  return {
    rootEntityId: root.id,
    nodes,
    relationships,
  };
}

export async function upsertEntityRelationship(
  pool: Pool,
  entityIdA: string,
  entityIdB: string,
  relationshipType: EntityRelationshipType,
  confidence: number,
  source: EntityRelationshipSource,
  summaryId: string | null = null,
  sinceAt: number | null = null,
  untilAt: number | null = null,
): Promise<void> {
  // Canonicalize pair order so (A,B) and (B,A) hit the same unique row
  const [canonA, canonB] = entityIdA < entityIdB ? [entityIdA, entityIdB] : [entityIdB, entityIdA];
  const id = ulid();
  const now = Date.now();

  await pool.query(
    `INSERT INTO entity_relationships (
       id,
       entity_id_a,
       entity_id_b,
       relationship_type,
       confidence,
       source,
       summary_id,
       since_at,
       until_at,
       created_at,
       updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (entity_id_a, entity_id_b, relationship_type) DO UPDATE SET
       confidence = EXCLUDED.confidence,
       source = EXCLUDED.source,
       summary_id = COALESCE(EXCLUDED.summary_id, entity_relationships.summary_id),
       since_at = COALESCE(EXCLUDED.since_at, entity_relationships.since_at),
       until_at = COALESCE(EXCLUDED.until_at, entity_relationships.until_at),
       updated_at = EXCLUDED.updated_at`,
    [id, canonA, canonB, relationshipType, confidence, source, summaryId, sinceAt, untilAt, now, now],
  );
}

export async function deleteEntityRelationship(pool: Pool, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM entity_relationships WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
