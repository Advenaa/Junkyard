import pg from 'pg';

type Pool = pg.Pool;

export type EntityAliasOrigin = 'seed' | 'llm' | 'manual' | 'unknown';

export interface EntityAliasRow {
  id: string;
  entity_id: string;
  alias: string;
  origin: EntityAliasOrigin;
  created_at: number;
}

const ENTITY_ALIAS_SELECT = `SELECT
       id,
       entity_id,
       alias,
       origin,
       created_at
     FROM entity_aliases`;

export async function getEntityAliases(pool: Pool, entityId: string): Promise<EntityAliasRow[]> {
  const { rows } = await pool.query<EntityAliasRow>(
    `${ENTITY_ALIAS_SELECT}
      WHERE entity_id = $1
      ORDER BY created_at ASC, alias ASC`,
    [entityId],
  );
  return rows;
}

export async function insertEntityAlias(
  pool: Pool,
  alias: {
    id: string;
    entityId: string;
    alias: string;
    origin: EntityAliasOrigin;
    createdAt: number;
  },
): Promise<EntityAliasRow | null> {
  const { rows } = await pool.query<EntityAliasRow>(
    `INSERT INTO entity_aliases (id, entity_id, alias, context_key, origin, created_at)
     VALUES ($1, $2, $3, '', $4, $5)
     ON CONFLICT DO NOTHING
     RETURNING id, entity_id, alias, origin, created_at`,
    [alias.id, alias.entityId, alias.alias, alias.origin, alias.createdAt],
  );
  return rows[0] ?? null;
}

export async function deleteEntityAlias(pool: Pool, id: string, entityId: string): Promise<EntityAliasRow | null> {
  const { rows } = await pool.query<EntityAliasRow>(
    `DELETE FROM entity_aliases
      WHERE id = $1
        AND entity_id = $2
      RETURNING id, entity_id, alias, origin, created_at`,
    [id, entityId],
  );
  return rows[0] ?? null;
}
