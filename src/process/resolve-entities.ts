import type { Pool } from '../db/connection.js';

/**
 * Resolve a set of normalized entity names to entity IDs.
 * Uses exact name match first, then falls back to alias lookup for unresolved names.
 */
export async function resolveEntityIds(pool: Pool, normalizedNames: string[]): Promise<Map<string, string>> {
  const entityIdByLookup = new Map<string, string>();
  if (normalizedNames.length === 0) return entityIdByLookup;

  const exactMatches = await pool.query<{ id: string; lookup_key: string }>(
    `SELECT id, LOWER(name) AS lookup_key FROM entities WHERE LOWER(name) = ANY($1)`,
    [normalizedNames],
  );
  for (const row of exactMatches.rows) {
    entityIdByLookup.set(row.lookup_key, row.id);
  }

  const unresolved = normalizedNames.filter((name) => !entityIdByLookup.has(name));
  if (unresolved.length > 0) {
    const aliasMatches = await pool.query<{ id: string; lookup_key: string }>(
      `SELECT DISTINCT ON (ea.alias)
          ea.entity_id AS id,
          ea.alias AS lookup_key
         FROM entity_aliases ea
         JOIN entities e ON e.id = ea.entity_id
        WHERE ea.alias = ANY($1)
        ORDER BY ea.alias, (e.status = 'active') DESC, (ea.context_key = '') DESC, ea.context_key, ea.entity_id`,
      [unresolved],
    );
    for (const row of aliasMatches.rows) {
      entityIdByLookup.set(row.lookup_key, row.id);
    }
  }

  return entityIdByLookup;
}
