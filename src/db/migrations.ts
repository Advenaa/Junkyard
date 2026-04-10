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
    await client.query(`INSERT INTO app_config (key, value) VALUES ($1, $2), ($3, $4)`, [
      'digest_time',
      '09:00',
      'timezone',
      'Asia/Jakarta',
    ]);
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
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_flash_per_day ON reports(date) WHERE type = 'flash'`,
    );
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_daily_per_day ON reports(date) WHERE type = 'daily'`,
    );
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
    await client.query(`ALTER TABLE items ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0`);
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

  // Migration 11: Add language column to entity_mentions for regional divergence analysis
  async (client) => {
    await client.query(`ALTER TABLE entity_mentions ADD COLUMN IF NOT EXISTS language TEXT`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_mentions_language ON entity_mentions(language) WHERE language IS NOT NULL`,
    );
  },

  // Migration 12: Add missing indexes for time-window queries (DB-020..023)
  async (client) => {
    // DB-020: summaries.created_at for time-window queries
    await client.query(`CREATE INDEX IF NOT EXISTS idx_summaries_created_at ON summaries(created_at DESC)`);

    // DB-021: llm_usage.created_at for health monitor queries
    await client.query(`CREATE INDEX IF NOT EXISTS idx_llm_usage_created_at ON llm_usage(created_at)`);

    // DB-022: reports(type, created_at) for health monitor queries
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reports_type_created ON reports(type, created_at)`);

    // DB-023: Rebuild idx_items_claim with source_id column for claimBatch
    await client.query(`DROP INDEX IF EXISTS idx_items_claim`);
    await client.query(`CREATE INDEX idx_items_claim ON items(status, source, source_id, timestamp)`);
  },

  // Migration 13: Widen all epoch-ms columns from INTEGER to BIGINT (AE-002)
  // Date.now() returns ~1.7 trillion which overflows PostgreSQL INTEGER (max ~2.1 billion).
  // ALTER TYPE INTEGER → BIGINT is non-destructive; existing rows are preserved.
  async (client) => {
    // sources
    await client.query(`ALTER TABLE sources ALTER COLUMN added_at TYPE BIGINT`);

    // source_state
    await client.query(`ALTER TABLE source_state ALTER COLUMN last_fetched_at TYPE BIGINT`);
    await client.query(`ALTER TABLE source_state ALTER COLUMN next_retry_at TYPE BIGINT`);

    // source_rate_history
    await client.query(`ALTER TABLE source_rate_history ALTER COLUMN updated_at TYPE BIGINT`);

    // items
    await client.query(`ALTER TABLE items ALTER COLUMN timestamp TYPE BIGINT`);
    await client.query(`ALTER TABLE items ALTER COLUMN created_at TYPE BIGINT`);

    // summaries
    await client.query(`ALTER TABLE summaries ALTER COLUMN window_start TYPE BIGINT`);
    await client.query(`ALTER TABLE summaries ALTER COLUMN window_end TYPE BIGINT`);
    await client.query(`ALTER TABLE summaries ALTER COLUMN created_at TYPE BIGINT`);

    // entities
    await client.query(`ALTER TABLE entities ALTER COLUMN first_seen TYPE BIGINT`);
    await client.query(`ALTER TABLE entities ALTER COLUMN last_seen TYPE BIGINT`);

    // entity_mentions
    await client.query(`ALTER TABLE entity_mentions ALTER COLUMN created_at TYPE BIGINT`);

    // reports
    await client.query(`ALTER TABLE reports ALTER COLUMN delivered_at TYPE BIGINT`);
    await client.query(`ALTER TABLE reports ALTER COLUMN created_at TYPE BIGINT`);

    // users
    await client.query(`ALTER TABLE users ALTER COLUMN created_at TYPE BIGINT`);
    await client.query(`ALTER TABLE users ALTER COLUMN last_login_at TYPE BIGINT`);

    // sessions
    await client.query(`ALTER TABLE sessions ALTER COLUMN expires_at TYPE BIGINT`);
    await client.query(`ALTER TABLE sessions ALTER COLUMN last_refreshed_at TYPE BIGINT`);
    await client.query(`ALTER TABLE sessions ALTER COLUMN created_at TYPE BIGINT`);

    // llm_usage
    await client.query(`ALTER TABLE llm_usage ALTER COLUMN created_at TYPE BIGINT`);

    // health_events
    await client.query(`ALTER TABLE health_events ALTER COLUMN created_at TYPE BIGINT`);

    // narratives
    await client.query(`ALTER TABLE narratives ALTER COLUMN created_at TYPE BIGINT`);

    // embeddings
    await client.query(`ALTER TABLE embeddings ALTER COLUMN created_at TYPE BIGINT`);
  },

  // Migration 14: Create discord_tokens table for UI-managed token storage
  async (client) => {
    await client.query(`
      CREATE TABLE discord_tokens (
        id TEXT PRIMARY KEY,
        encrypted_token TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        label TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        added_at BIGINT NOT NULL,
        last_used_at BIGINT
      )
    `);
  },

  // Migration 15: Create user audit log for account management activity
  async (client) => {
    await client.query(`
      CREATE TABLE user_audit_log (
        id TEXT PRIMARY KEY,
        actor_discord_id TEXT NOT NULL,
        actor_username TEXT NOT NULL,
        target_discord_id TEXT NOT NULL,
        target_username TEXT,
        action TEXT NOT NULL CHECK (action IN ('invite', 'role_change')),
        previous_role TEXT,
        new_role TEXT,
        created_at BIGINT NOT NULL
      )
    `);
    await client.query(`CREATE INDEX idx_user_audit_log_created_at ON user_audit_log(created_at DESC)`);
    await client.query(`CREATE INDEX idx_user_audit_log_target ON user_audit_log(target_discord_id, created_at DESC)`);
  },

  // Migration 16: Expand audit actions for access-request decisions
  async (client) => {
    await client.query(`ALTER TABLE user_audit_log DROP CONSTRAINT IF EXISTS user_audit_log_action_check`);
    await client.query(`
      ALTER TABLE user_audit_log
        ADD CONSTRAINT user_audit_log_action_check
        CHECK (action IN ('invite', 'role_change', 'request_approved', 'request_rejected'))
    `);
  },

  // Migration 17: Create access_requests table for self-service account requests
  async (client) => {
    await client.query(`
      CREATE TABLE access_requests (
        id TEXT PRIMARY KEY,
        discord_id TEXT NOT NULL,
        requested_role TEXT NOT NULL CHECK (requested_role IN ('viewer', 'admin')),
        note TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        resolved_role TEXT CHECK (resolved_role IN ('viewer', 'admin')),
        decided_at BIGINT,
        decided_by_discord_id TEXT,
        created_at BIGINT NOT NULL
      )
    `);
    await client.query(
      `CREATE INDEX idx_access_requests_status_created_at ON access_requests(status, created_at DESC)`,
    );
    await client.query(
      `CREATE INDEX idx_access_requests_discord_id_created_at ON access_requests(discord_id, created_at DESC)`,
    );
  },

  // Migration 18: Add encrypted per-token proxy configuration
  async (client) => {
    await client.query(`ALTER TABLE discord_tokens ADD COLUMN proxy_url_encrypted TEXT`);
    await client.query(`ALTER TABLE discord_tokens ADD COLUMN proxy_url_iv TEXT`);
    await client.query(`ALTER TABLE discord_tokens ADD COLUMN proxy_url_auth_tag TEXT`);
  },

  // Migration 19: Create calendar_events table for cycle detection foundation
  async (client) => {
    await client.query(`
      CREATE TABLE calendar_events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN ('macro', 'unlock', 'expiry', 'governance', 'launch', 'legal', 'custom')),
        description TEXT,
        recurrence_rule TEXT,
        next_occurrence BIGINT NOT NULL,
        created_at BIGINT NOT NULL
      )
    `);
    await client.query(`CREATE INDEX idx_calendar_events_next_occurrence ON calendar_events(next_occurrence ASC)`);
  },
  // Migration 20: Link calendar events to entities for event-specific analysis
  async (client) => {
    await client.query(`
      ALTER TABLE calendar_events
        ADD COLUMN entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL
    `);
    await client.query(`CREATE INDEX idx_calendar_events_entity_id ON calendar_events(entity_id)`);
  },
  // Migration 21: Create events table for event-chain foundation
  async (client) => {
    await client.query(`
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
        entity_name TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK (event_type IN ('exploit', 'audit', 'governance', 'launch', 'partnership', 'funding', 'hack', 'legal')),
        description TEXT NOT NULL,
        event_time BIGINT NOT NULL,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        summary_id TEXT NOT NULL REFERENCES summaries(id) ON DELETE CASCADE,
        chain_id TEXT REFERENCES events(id) ON DELETE SET NULL,
        created_at BIGINT NOT NULL
      )
    `);
    await client.query(`CREATE INDEX idx_events_entity_time ON events(entity_id, event_time DESC)`);
    await client.query(`CREATE INDEX idx_events_summary_id ON events(summary_id)`);
    await client.query(`CREATE INDEX idx_events_chain_id ON events(chain_id)`);
  },

  // Migration 22: Create entity_relationships table (2.4 Competitor Mapping)
  async (client) => {
    await client.query(`
      CREATE TABLE entity_relationships (
        id TEXT PRIMARY KEY,
        entity_id_a TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        entity_id_b TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        relationship_type TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.7,
        source TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        CONSTRAINT chk_entity_relationships_relationship_type CHECK (
          relationship_type IN ('competes_with', 'built_on', 'invested_in', 'forked_from')
        ),
        CONSTRAINT chk_entity_relationships_source CHECK (
          source IN ('llm_inferred', 'manual', 'coingecko')
        ),
        CONSTRAINT chk_entity_relationships_no_self CHECK (
          entity_id_a <> entity_id_b
        ),
        CONSTRAINT uq_entity_relationships_entity_pair_type UNIQUE (
          entity_id_a,
          entity_id_b,
          relationship_type
        )
      )
    `);
    await client.query(`CREATE INDEX idx_entity_relationships_entity_id_a ON entity_relationships(entity_id_a)`);
    await client.query(`CREATE INDEX idx_entity_relationships_entity_id_b ON entity_relationships(entity_id_b)`);
  },
  // Migration 23: Expand entity relationship types for structured graph work
  async (client) => {
    await client.query(`
      ALTER TABLE entity_relationships
      DROP CONSTRAINT chk_entity_relationships_relationship_type
    `);
    await client.query(`
      ALTER TABLE entity_relationships
      ADD CONSTRAINT chk_entity_relationships_relationship_type CHECK (
        relationship_type IN (
          'competes_with',
          'built_on',
          'invested_in',
          'forked_from',
          'acquired',
          'founded',
          'advises',
          'partnered_with',
          'regulated_by'
        )
      )
    `);
  },
  // Migration 24: Add nullable summary evidence for inferred relationships
  async (client) => {
    await client.query(`
      ALTER TABLE entity_relationships
      ADD COLUMN summary_id TEXT REFERENCES summaries(id) ON DELETE SET NULL
    `);
    await client.query(`CREATE INDEX idx_entity_relationships_summary_id ON entity_relationships(summary_id)`);
  },
  // Migration 25: Add nullable temporal bounds for relationships
  async (client) => {
    await client.query(`
      ALTER TABLE entity_relationships
      ADD COLUMN since_at BIGINT,
      ADD COLUMN until_at BIGINT
    `);
  },

  // Migration 26: Backfill entity_mentions.language NULL → 'eng' (H-001)
  // + CHECK constraints on entity_relationships confidence range (M-001) and temporal order (M-002)
  async (client) => {
    // H-001: English mentions were stored with language = NULL instead of 'eng'
    await client.query(`UPDATE entity_mentions SET language = 'eng' WHERE language IS NULL`);

    // M-001: confidence must be in [0, 1]
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE entity_relationships
          ADD CONSTRAINT chk_confidence_range
          CHECK (confidence >= 0 AND confidence <= 1);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // M-002: since_at must be <= until_at when both are set
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE entity_relationships
          ADD CONSTRAINT chk_temporal_order
          CHECK (since_at IS NULL OR until_at IS NULL OR since_at <= until_at);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
  },

  // Migration 27: Create price_snapshots table for price feeds (Feature 3.1)
  async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS price_snapshots (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        timestamp BIGINT NOT NULL,
        price_usd REAL NOT NULL,
        price_change_24h REAL,
        price_change_7d REAL,
        volume_24h REAL,
        market_cap REAL,
        source TEXT NOT NULL DEFAULT 'coingecko',
        created_at BIGINT NOT NULL
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_price_snapshots_entity_time
        ON price_snapshots(entity_id, timestamp DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_price_snapshots_timestamp
        ON price_snapshots(timestamp DESC)
    `);
  },

  // Migration 28: Source tiers + alpha propagation tracking (Feature 3.6)
  async (client) => {
    await client.query(`ALTER TABLE sources ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'general'`);

    // Add CHECK constraint for tier values
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE sources ADD CONSTRAINT chk_sources_tier CHECK (tier IN ('alpha', 'influencer', 'general', 'mainstream'));
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS alpha_propagation (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
        tier TEXT NOT NULL,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        first_mention_time BIGINT NOT NULL,
        item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
        created_at BIGINT NOT NULL
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_alpha_propagation_entity
        ON alpha_propagation(entity_id, first_mention_time DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_alpha_propagation_event
        ON alpha_propagation(event_id)
    `);
  },

  // Migration 29: Author tracking tables (Feature 3.2)
  async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS authors (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        handle TEXT NOT NULL,
        display_name TEXT,
        first_seen BIGINT NOT NULL,
        last_seen BIGINT NOT NULL,
        mention_count INTEGER NOT NULL DEFAULT 0,
        credibility_score REAL,
        total_calls INTEGER NOT NULL DEFAULT 0,
        correct_calls INTEGER NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_authors_platform_handle
        ON authors(platform, handle)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_authors_credibility
        ON authors(credibility_score DESC NULLS LAST)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS author_calls (
        id TEXT PRIMARY KEY,
        author_id TEXT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        claim_type TEXT NOT NULL CHECK (claim_type IN ('bullish', 'bearish', 'event', 'neutral')),
        claim_text TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        source_item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
        timestamp BIGINT NOT NULL,
        resolved BOOLEAN NOT NULL DEFAULT false,
        outcome TEXT CHECK (outcome IN ('correct', 'incorrect', 'unresolved', NULL)),
        resolved_at BIGINT,
        created_at BIGINT NOT NULL
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_author_calls_author
        ON author_calls(author_id, timestamp DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_author_calls_entity
        ON author_calls(entity_id, timestamp DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_author_calls_unresolved
        ON author_calls(resolved, timestamp) WHERE resolved = false
    `);
  },

  // Migration 30: Create macro_snapshots table for cross-market correlation (Feature 3.3)
  async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS macro_snapshots (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        indicator TEXT NOT NULL CHECK (indicator IN ('vix', 'dxy', 'us10y', 'spx')),
        value REAL NOT NULL,
        change_1d REAL,
        change_7d REAL,
        source TEXT NOT NULL DEFAULT 'fred',
        created_at BIGINT NOT NULL
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_macro_snapshots_indicator_date
        ON macro_snapshots(indicator, date)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_macro_snapshots_date
        ON macro_snapshots(date DESC)
    `);
  },

  // Migration 31: Expand macro_snapshots indicators to include gold (Feature 3.3)
  async (client) => {
    await client.query(`
      ALTER TABLE macro_snapshots
      DROP CONSTRAINT IF EXISTS macro_snapshots_indicator_check
    `);
    await client.query(`
      ALTER TABLE macro_snapshots
      ADD CONSTRAINT macro_snapshots_indicator_check
      CHECK (indicator IN ('vix', 'dxy', 'us10y', 'spx', 'gold'))
    `);
  },

  // Migration 32: Persist daily macro regime history (Feature 3.4)
  async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS macro_regimes (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL UNIQUE REFERENCES reports(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        report_type TEXT NOT NULL CHECK (report_type IN ('daily', 'pulse')),
        classification TEXT NOT NULL CHECK (classification IN ('risk-on', 'risk-off', 'transition', 'unclear')),
        confidence REAL NOT NULL,
        rationale TEXT NOT NULL,
        created_at BIGINT NOT NULL
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_macro_regimes_type_date
        ON macro_regimes(report_type, date DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_macro_regimes_classification_date
        ON macro_regimes(classification, date DESC)
    `);
  },

  // Migration 33: Persist chat daily token budget usage (H-050)
  async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_daily_usage (
        user_id TEXT NOT NULL,
        usage_day TEXT NOT NULL,
        token_count INTEGER NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, usage_day)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_daily_usage_day
        ON chat_daily_usage(usage_day DESC)
    `);
  },

  // Migration 34: Partial index for sentiment-bearing entity_mentions (M-085)
  // The pulse, divergence, and sentiment-momentum queries all combine
  // `WHERE created_at BETWEEN ... AND sentiment IS NOT NULL` and group by
  // entity_id. The existing idx_mentions_entity_ts(created_at, entity_id)
  // does not know that sentiment is often NULL — partial pruning here cuts
  // the scanned rowset to just the sentiment-bearing slice.
  async (client) => {
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_mentions_sentiment_ts
        ON entity_mentions(created_at, entity_id)
        WHERE sentiment IS NOT NULL
    `);
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
      `SELECT version FROM schema_version ORDER BY version DESC LIMIT 1`,
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
    await client.query('SELECT pg_advisory_unlock(42424242)').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
