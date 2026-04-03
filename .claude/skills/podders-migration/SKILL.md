# Podders Migration Skill

Create a new database migration in `src/db/migrations.ts` following Podders conventions.

## Usage

```
/podders-migration <description>
```

The `$ARGUMENTS` is the migration description (e.g., "Add verified column to entities", "Create alerts table").

## Steps

1. **Read `src/db/migrations.ts`** to find the current highest migration number. Look at the last comment in the `migrations` array (e.g., `// Migration 13: ...`). The next migration number is that + 1.

2. **Add a new migration function** as the last element of the `migrations` array (before the closing `];`). Use this template:

```typescript
  // Migration <N>: <description from $ARGUMENTS>
  async (client) => {
    // migration SQL here
  },
```

3. **Do NOT modify `runMigrations()`** or any other existing code. Only append to the `migrations` array.

## Conventions (MUST follow)

- **BIGINT for epoch-ms columns** — never use INTEGER for timestamps. `Date.now()` overflows PostgreSQL INTEGER.
- **TEXT for IDs** — all IDs are ULID strings stored as TEXT. No autoincrement, no UUIDs. Exception: session IDs use `crypto.randomBytes` hex.
- **`IF NOT EXISTS`** — always use for `CREATE TABLE` and `CREATE INDEX`.
- **Idempotent ALTER TABLE** — for `ADD COLUMN`, wrap in a PL/pgSQL block:
  ```sql
  DO $$ BEGIN
    ALTER TABLE <table> ADD COLUMN <col> <type> <constraints>;
  EXCEPTION WHEN duplicate_column THEN NULL;
  END $$
  ```
  For `ADD CONSTRAINT`, use `DROP CONSTRAINT IF EXISTS` then `ADD CONSTRAINT`.
- **CHECK constraints for status/enum columns** — e.g., `CHECK (status IN ('active', 'inactive'))`.
- **Indexes** — new tables need appropriate indexes. Use `CREATE INDEX IF NOT EXISTS`.
- **No down migrations** — this project only has up migrations.
- **Foreign keys** — use `REFERENCES <table>(<col>)` with `ON DELETE CASCADE` where appropriate.
- **JSONB for metadata** — use `JSONB DEFAULT '{}'` for flexible metadata columns.
- **Arrays** — use PostgreSQL array types (e.g., `TEXT[]`) where appropriate (see narratives.summary_ids).

## Common Patterns

### Add a column to an existing table

```typescript
  // Migration <N>: Add verified column to entities
  async (client) => {
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE entities ADD COLUMN verified BOOLEAN NOT NULL DEFAULT false;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_entities_verified
        ON entities(verified) WHERE verified = true
    `);
  },
```

### Create a new table

```typescript
  // Migration <N>: Create alerts table
  async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        acknowledged BOOLEAN DEFAULT false,
        created_at BIGINT NOT NULL,
        CHECK (type IN ('price', 'volume', 'sentiment', 'narrative')),
        CHECK (severity IN ('info', 'warning', 'critical'))
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_alerts_entity
        ON alerts(entity_id, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_alerts_unacked
        ON alerts(acknowledged, created_at DESC)
        WHERE acknowledged = false
    `);
  },
```

### Add an index

```typescript
  // Migration <N>: Add index on items(author) for author lookup
  async (client) => {
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_items_author
        ON items(author)
    `);
  },
```

### Widen a column type

```typescript
  // Migration <N>: Widen items.engagement from INTEGER to BIGINT
  async (client) => {
    await client.query(`ALTER TABLE items ALTER COLUMN engagement TYPE BIGINT`);
  },
```

### Add or replace a CHECK constraint

```typescript
  // Migration <N>: Add 'paused' to source_state.status CHECK
  async (client) => {
    await client.query(`ALTER TABLE source_state DROP CONSTRAINT IF EXISTS chk_source_state_status`);
    await client.query(`
      ALTER TABLE source_state
        ADD CONSTRAINT chk_source_state_status
        CHECK (status IN ('active', 'disabled', 'halted', 'paused'))
    `);
  },
```

### Add a unique partial index

```typescript
  // Migration <N>: Prevent duplicate entities by name+type
  async (client) => {
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_name_type_active
        ON entities(name, type) WHERE status = 'active'
    `);
  },
```
