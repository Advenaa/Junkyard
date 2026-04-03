import pg from 'pg';

type Migration = (client: pg.PoolClient) => Promise<void>;

const migrations: Migration[] = [
  // Migration 1: Create all 17 tables
  async (client) => {
    await client.query(`
      CREATE TABLE sources (
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        label TEXT,
        enabled BOOLEAN DEFAULT true,
        priority INTEGER DEFAULT 1,
        poll_interval INTEGER DEFAULT 7200,
        trust_weight REAL NOT NULL DEFAULT 0.5,
        initial_trust_weight REAL NOT NULL DEFAULT 0.5,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (source, source_id)
      )
    `);

    await client.query(`
      CREATE TABLE source_state (
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        last_fetched_at INTEGER,
        last_id TEXT,
        error_count INTEGER DEFAULT 0,
        last_error TEXT,
        next_retry_at INTEGER,
        PRIMARY KEY (source, source_id)
      )
    `);

    await client.query(`
      CREATE TABLE source_rate_history (
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        hour_of_day INTEGER NOT NULL,
        day_of_week INTEGER NOT NULL,
        avg_rate REAL NOT NULL,
        sample_count INTEGER DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (source, source_id, hour_of_day, day_of_week)
      )
    `);

    await client.query(`
      CREATE TABLE items (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        author TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        url TEXT,
        engagement INTEGER DEFAULT 0,
        attachments TEXT,
        content_hash TEXT NOT NULL,
        content_anchor TEXT,
        original_language TEXT,
        translated BOOLEAN DEFAULT false,
        filter_reason TEXT,
        status TEXT DEFAULT 'ready',
        batch_id TEXT,
        created_at INTEGER NOT NULL
      )
    `);
    await client.query(`CREATE INDEX idx_items_claim ON items(status, source, timestamp)`);
    await client.query(`CREATE INDEX idx_items_hash ON items(content_hash)`);
    await client.query(`
      ALTER TABLE items ADD COLUMN content_tsv tsvector
        GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
    `);
    await client.query(`CREATE INDEX idx_items_fts ON items USING GIN (content_tsv)`);

    await client.query(`
      CREATE TABLE summaries (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        window_end INTEGER NOT NULL,
        body TEXT NOT NULL,
        sentiment REAL,
        urgency TEXT,
        item_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        relevance REAL DEFAULT 0,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        UNIQUE(name, type)
      )
    `);

    await client.query(`
      CREATE TABLE entity_aliases (
        alias TEXT NOT NULL,
        context_key TEXT NOT NULL DEFAULT '',
        entity_id TEXT NOT NULL REFERENCES entities(id),
        PRIMARY KEY (alias, context_key)
      )
    `);

    await client.query(`
      CREATE TABLE entity_mentions (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL REFERENCES entities(id),
        source TEXT NOT NULL,
        summary_id TEXT REFERENCES summaries(id),
        sentiment REAL,
        mention_count INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL
      )
    `);
    await client.query(`CREATE INDEX idx_mentions_entity_ts ON entity_mentions(created_at, entity_id)`);

    await client.query(`
      CREATE TABLE reports (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        type TEXT DEFAULT 'daily',
        body TEXT NOT NULL,
        tldr TEXT,
        sentiment REAL,
        delivery_status TEXT DEFAULT 'pending',
        delivered_at INTEGER,
        created_at INTEGER NOT NULL
      )
    `);
    await client.query(`CREATE INDEX idx_reports_date ON reports(date)`);

    await client.query(`
      CREATE TABLE users (
        discord_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        avatar TEXT,
        role TEXT NOT NULL DEFAULT 'viewer',
        created_at INTEGER NOT NULL,
        last_login_at INTEGER
      )
    `);

    await client.query(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        last_refreshed_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        ip_address TEXT,
        user_agent TEXT
      )
    `);
    await client.query(`CREATE INDEX idx_sessions_discord_id ON sessions(discord_id)`);
    await client.query(`CREATE INDEX idx_sessions_expires ON sessions(expires_at)`);

    await client.query(`
      CREATE TABLE app_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE llm_usage (
        id TEXT PRIMARY KEY,
        stage TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE health_events (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        acknowledged BOOLEAN DEFAULT false,
        created_at INTEGER NOT NULL
      )
    `);
    await client.query(`
      CREATE INDEX idx_health_events_unacked
        ON health_events (acknowledged, created_at DESC)
        WHERE acknowledged = false
    `);

    await client.query(`
      CREATE TABLE narratives (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        date DATE NOT NULL,
        member_count INTEGER NOT NULL,
        avg_sentiment REAL,
        signal_strength TEXT NOT NULL,
        summary_ids TEXT[] NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    await client.query(`CREATE INDEX idx_narratives_date ON narratives(date DESC)`);

    await client.query(`
      CREATE TABLE embeddings (
        id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BYTEA NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(target_type, target_id)
      )
    `);
    await client.query(`CREATE INDEX idx_embeddings_target ON embeddings(target_type, target_id)`);
    await client.query(`CREATE INDEX idx_embeddings_type ON embeddings(target_type, created_at)`);

    // Seed app_config
    await client.query(
      `INSERT INTO app_config (key, value) VALUES ($1, $2), ($3, $4)`,
      ['digest_time', '09:00', 'timezone', 'Asia/Jakarta'],
    );
  },

  // Migration 2: Add UNIQUE index on items.content_hash for atomic dedup (H-004)
  async (client) => {
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_items_content_hash
        ON items(content_hash) WHERE content_hash IS NOT NULL
    `);
  },

  // Migration 3: Add ON DELETE CASCADE to entity_mentions.summary_id FK (H-007)
  async (client) => {
    await client.query(`
      ALTER TABLE entity_mentions
        DROP CONSTRAINT IF EXISTS entity_mentions_summary_id_fkey
    `);
    await client.query(`
      ALTER TABLE entity_mentions
        ADD CONSTRAINT entity_mentions_summary_id_fkey
        FOREIGN KEY (summary_id) REFERENCES summaries(id) ON DELETE CASCADE
    `);
  },

  // Migration 4: Add missing indexes (H-045, M-070, M-071, M-072)
  async (client) => {
    // H-045: summaries(window_start, window_end) — used by daily synthesis, pulse, correlator
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_summaries_window
        ON summaries(window_start, window_end)
    `);

    // M-070: items(url) partial — used by normalize URL dedup
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_items_url
        ON items(url) WHERE url IS NOT NULL
    `);

    // M-071: items(batch_id) partial — used by summarizer
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_items_batch_id
        ON items(batch_id) WHERE batch_id IS NOT NULL
    `);

    // M-072: entity_mentions(entity_id) and entity_mentions(summary_id) — used by Tier 2 disambiguation
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_entity_mentions_entity_id
        ON entity_mentions(entity_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_entity_mentions_summary_id
        ON entity_mentions(summary_id)
    `);
  },

  // Migration 5: Add CHECK constraints on enum TEXT columns (M-074)
  async (client) => {
    await client.query(`
      ALTER TABLE items
        ADD CONSTRAINT chk_items_status
        CHECK (status IN ('ready', 'filtered', 'processing', 'processed'))
    `);

    await client.query(`
      ALTER TABLE reports
        ADD CONSTRAINT chk_reports_type
        CHECK (type IN ('daily', 'flash', 'pulse'))
    `);

    await client.query(`
      ALTER TABLE entities
        ADD CONSTRAINT chk_entities_status
        CHECK (status IN ('active', 'archived'))
    `);

    await client.query(`
      ALTER TABLE users
        ADD CONSTRAINT chk_users_role
        CHECK (role IN ('admin', 'viewer', 'blocked'))
    `);
  },

  // Migration 6: Drop redundant idx_embeddings_target (L-028)
  // The UNIQUE(target_type, target_id) constraint on embeddings already creates an auto-index
  async (client) => {
    await client.query(`DROP INDEX IF EXISTS idx_embeddings_target`);
  },

  // Migration 7: Add unique partial indexes on reports to prevent duplicate flash/pulse/daily per date (CL-005)
  async (client) => {
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_flash_per_day ON reports(date) WHERE type = 'flash'`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_daily_per_day ON reports(date) WHERE type = 'daily'`);
  },

  // Migration 8: Add 'failed' to items.status CHECK constraint (CF-002)
  async (client) => {
    await client.query(`ALTER TABLE items DROP CONSTRAINT IF EXISTS chk_items_status`);
    await client.query(`
      ALTER TABLE items
        ADD CONSTRAINT chk_items_status
        CHECK (status IN ('ready', 'filtered', 'processing', 'processed', 'failed'))
    `);
  },

  // Migration 9: Add retry_count to items for retry limiting (DP-003)
  async (client) => {
    await client.query(
      `ALTER TABLE items ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0`,
    );
  },

  // Migration 10: Create entity_sentiment_daily table for sentiment momentum (Feature 2.1)
  async (client) => {
    await client.query(`
      CREATE TABLE entity_sentiment_daily (
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        avg_sentiment REAL NOT NULL,
        mention_count INTEGER NOT NULL DEFAULT 0,
        momentum REAL,
        PRIMARY KEY (entity_id, date)
      )
    `);
    await client.query(`CREATE INDEX idx_sentiment_daily_date ON entity_sentiment_daily(date)`);
    await client.query(`CREATE INDEX idx_sentiment_daily_entity ON entity_sentiment_daily(entity_id, date DESC)`);
  },
];

export async function runMigrations(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // Acquire advisory lock to prevent concurrent migrations (D-008)
    await client.query('SELECT pg_advisory_lock(42424242)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)
    `);

    const { rows } = await client.query<{ version: number }>(
      `SELECT version FROM schema_version`,
    );

    let currentVersion: number;
    if (rows.length === 0) {
      await client.query(`INSERT INTO schema_version (version) VALUES (0)`);
      currentVersion = 0;
    } else {
      currentVersion = rows[0].version;
    }

    for (let i = currentVersion; i < migrations.length; i++) {
      const migrationIndex = i;
      const nextVersion = migrationIndex + 1;

      await client.query('BEGIN');
      try {
        await migrations[migrationIndex](client);
        await client.query(`UPDATE schema_version SET version = $1`, [nextVersion]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    await client.query('SELECT pg_advisory_unlock(42424242)');
  } catch (err) {
    // Advisory lock is released when the connection is returned to the pool
    throw err;
  } finally {
    client.release();
  }
}
