import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newDb } from 'pg-mem';

import type { Pool } from '../../src/db/connection.js';
import type { RawItem } from '../../src/ingest/rss.js';
import type { createLLM, LLMCallParams, LLMCallResult, Stage } from '../../src/llm.js';
import { createEntityManager } from '../../src/knowledge/entities.js';
import { createNormalizer } from '../../src/normalize/index.js';
import { createCorrelator } from '../../src/process/correlate.js';
import { createSummarizer } from '../../src/process/summarize.js';
import { fakeConfig, makeMockLogger } from '../helpers/factories.js';

type QueryParams = readonly unknown[] | undefined;

interface QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rowCount: number | null | undefined;
  rows: Row[];
}

interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: QueryParams,
  ): Promise<QueryResult<Row>>;
}

interface WrappedClient extends Queryable {
  release(): void;
}

interface WrappedPool extends Queryable {
  connect(): Promise<WrappedClient>;
  end(): Promise<void>;
}

interface SetupDbResult {
  pool: Pool;
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function assertNumber(value: unknown, label: string): number {
  assert.equal(typeof value, 'number', `${label} must be a number`);
  return value;
}

function assertStringArray(value: unknown, label: string): string[] {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  assert.ok(
    value.every((entry) => typeof entry === 'string'),
    `${label} must contain strings`,
  );
  return [...value];
}

function assertNumberArray(value: unknown, label: string): number[] {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  assert.ok(
    value.every((entry) => typeof entry === 'number'),
    `${label} must contain numbers`,
  );
  return [...value];
}

function makeInClause(values: readonly unknown[], startAt = 1): string {
  return values.map((_, index) => `$${startAt + index}`).join(', ');
}

async function maybeHandleQuery(raw: Queryable, sql: string, params: QueryParams): Promise<QueryResult | null> {
  const normalized = normalizeSql(sql);
  const bound = params ?? [];

  if (
    normalized.includes('insert into items (') &&
    normalized.includes('on conflict (content_hash) where content_hash is not null do nothing')
  ) {
    const contentHash = bound[8];
    assert.equal(typeof contentHash, 'string', 'content_hash must be a string');

    const existing = await raw.query<{ id: string }>('SELECT id FROM items WHERE content_hash = $1 LIMIT 1', [
      contentHash,
    ]);
    if (existing.rows.length > 0) {
      return { rowCount: 0, rows: [] };
    }

    return raw.query(
      `INSERT INTO items (
        id, source, source_id, author, content, timestamp, url, engagement,
        content_hash, status, original_language, translated, attachments,
        filter_reason, content_anchor, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13,
        $14, $15, $16
      )`,
      bound,
    );
  }

  if (
    normalized.includes('update entities set relevance = entities.relevance + data.weight') &&
    normalized.includes('select unnest($2::text[]) as id') &&
    normalized.includes('unnest($3::real[]) as weight')
  ) {
    const lastSeen = assertNumber(bound[0], 'lastSeen');
    const ids = assertStringArray(bound[1], 'entity ids');
    const weights = assertNumberArray(bound[2], 'entity weights');
    assert.equal(ids.length, weights.length, 'entity ids and weights must have the same length');

    let rowCount = 0;
    for (let index = 0; index < ids.length; index++) {
      const result = await raw.query(
        `UPDATE entities
            SET relevance = relevance + $2,
                last_seen = $3
          WHERE id = $1`,
        [ids[index], weights[index], lastSeen],
      );
      rowCount += result.rowCount ?? 0;
    }

    return { rowCount, rows: [] };
  }

  if (normalized === "update items set status = 'processed' where id = any($1::text[])") {
    const ids = assertStringArray(bound[0], 'processed item ids');
    if (ids.length === 0) {
      return { rowCount: 0, rows: [] };
    }

    return raw.query(`UPDATE items SET status = 'processed' WHERE id IN (${makeInClause(ids)})`, ids);
  }

  if (normalized === 'select id, urgency, source_id, source from summaries where id = any($1)') {
    const ids = assertStringArray(bound[0], 'summary ids');
    if (ids.length === 0) {
      return { rowCount: 0, rows: [] };
    }

    return raw.query(
      `SELECT id, urgency, source_id, source
         FROM summaries
        WHERE id IN (${makeInClause(ids)})
        ORDER BY id`,
      ids,
    );
  }

  if (
    normalized.includes('select em.entity_id, e.name as entity_name,') &&
    normalized.includes('json_agg(json_build_object(') &&
    normalized.includes('from entity_mentions em join entities e on e.id = em.entity_id')
  ) {
    const cutoff = assertNumber(bound[0], 'correlation cutoff');
    const mentionRows = await raw.query<{
      entity_id: string;
      entity_name: string;
      source: string;
      summary_id: string;
      sentiment: number | null;
      created_at: number;
    }>(
      `SELECT em.entity_id, e.name AS entity_name, em.source, em.summary_id, em.sentiment, em.created_at
         FROM entity_mentions em
         JOIN entities e ON e.id = em.entity_id
        WHERE em.created_at >= $1
        ORDER BY em.created_at DESC`,
      [cutoff],
    );

    const grouped = new Map<
      string,
      {
        entityName: string;
        mentions: Array<{ source: string; summary_id: string; sentiment: number }>;
        sources: Set<string>;
      }
    >();

    for (const row of mentionRows.rows) {
      const group = grouped.get(row.entity_id) ?? {
        entityName: row.entity_name,
        mentions: [],
        sources: new Set<string>(),
      };
      group.mentions.push({
        source: row.source,
        summary_id: row.summary_id,
        sentiment: row.sentiment ?? 0,
      });
      group.sources.add(row.source);
      grouped.set(row.entity_id, group);
    }

    const rows = [...grouped.entries()]
      .filter(([, group]) => group.sources.size >= 2)
      .map(([entityId, group]) => ({
        entity_id: entityId,
        entity_name: group.entityName,
        mentions: group.mentions,
      }));

    return { rowCount: rows.length, rows };
  }

  return null;
}

function wrapQueryable(raw: Queryable & Partial<WrappedClient>): WrappedClient {
  return {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params?: QueryParams,
    ): Promise<QueryResult<Row>> {
      const handled = await maybeHandleQuery(raw, sql, params);
      if (handled !== null) {
        return handled as QueryResult<Row>;
      }

      return raw.query<Row>(sql, params);
    },
    release() {
      raw.release?.();
    },
  };
}

function createWrappedPool(rawPool: WrappedPool): Pool {
  const pool: WrappedPool = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params?: QueryParams,
    ): Promise<QueryResult<Row>> {
      const handled = await maybeHandleQuery(rawPool, sql, params);
      if (handled !== null) {
        return handled as QueryResult<Row>;
      }

      return rawPool.query<Row>(sql, params);
    },
    async connect(): Promise<WrappedClient> {
      const rawClient = await rawPool.connect();
      return wrapQueryable(rawClient);
    },
    async end(): Promise<void> {
      await rawPool.end();
    },
  };

  return pool as unknown as Pool;
}

function setupDb(): SetupDbResult {
  const db = newDb();

  db.public.none(`
    CREATE TABLE app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE sources (
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      name TEXT,
      trust_weight REAL NOT NULL DEFAULT 0.5,
      poll_interval INTEGER NOT NULL DEFAULT 300000,
      PRIMARY KEY (source, source_id)
    );

    CREATE TABLE source_state (
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      last_id TEXT,
      last_poll_at INTEGER,
      error_count INTEGER DEFAULT 0,
      PRIMARY KEY (source, source_id)
    );

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
      translated BOOLEAN DEFAULT FALSE,
      filter_reason TEXT,
      status TEXT DEFAULT 'ready',
      batch_id TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_items_claim ON items(status, source, source_id, timestamp);
    CREATE UNIQUE INDEX idx_items_content_hash ON items(content_hash);

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
    );

    CREATE TABLE entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      relevance REAL NOT NULL DEFAULT 0,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      UNIQUE(name, type)
    );

    CREATE TABLE entity_aliases (
      id TEXT NOT NULL UNIQUE,
      alias TEXT NOT NULL,
      context_key TEXT NOT NULL DEFAULT '',
      entity_id TEXT NOT NULL REFERENCES entities(id),
      origin TEXT NOT NULL DEFAULT 'unknown',
      created_at INTEGER NOT NULL,
      PRIMARY KEY (alias, context_key)
    );

    CREATE TABLE entity_mentions (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL REFERENCES entities(id),
      source TEXT NOT NULL,
      summary_id TEXT REFERENCES summaries(id),
      sentiment REAL,
      mention_count INTEGER DEFAULT 1,
      language TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE reports (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      type TEXT DEFAULT 'daily',
      body TEXT NOT NULL,
      tldr TEXT,
      sentiment REAL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE llm_usage (
      id TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      stage TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE health_events (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata TEXT,
      acknowledged BOOLEAN DEFAULT FALSE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE narratives (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      date DATE NOT NULL,
      member_count INTEGER NOT NULL,
      avg_sentiment REAL,
      signal_strength TEXT NOT NULL,
      summary_ids TEXT[],
      created_at INTEGER NOT NULL
    );

    CREATE TABLE authors (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      handle TEXT NOT NULL,
      display_name TEXT,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      mention_count INTEGER NOT NULL DEFAULT 0,
      total_calls INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX idx_authors_platform_handle ON authors(platform, handle);
  `);

  const { Pool: PgMemPool } = db.adapters.createPg();
  const rawPool = new PgMemPool() as unknown as WrappedPool;

  return { pool: createWrappedPool(rawPool) };
}

function mockLlm(responses: Partial<Record<Stage, string>>) {
  return {
    async call(params: LLMCallParams): Promise<LLMCallResult> {
      return {
        content: responses[params.stage] ?? '{}',
        usage: { input_tokens: 100, output_tokens: 50 },
        cost: 0.001,
      };
    },
    wrapWithNonce(content: string) {
      return { wrapped: `<scraped_content_test>${content}</scraped_content_test>`, nonce: 'test' };
    },
  };
}

function makeRawItem(overrides: Partial<RawItem> = {}): RawItem {
  return {
    id: 'raw-item-1',
    source: 'discord',
    sourceId: 'channel-1',
    author: 'alice',
    content: 'Bitcoin looks strong after fresh ETF headlines.',
    timestamp: 1_717_171_717,
    url: undefined,
    engagement: 12,
    attachments: undefined,
    metadata: {},
    ...overrides,
  };
}

const config = fakeConfig();

describe('pipeline integration with pg-mem', () => {
  it('normalize inserts item with content_hash into database', async () => {
    const { pool } = setupDb();
    const logger = makeMockLogger();
    const normalizer = createNormalizer(pool, logger, config, mockLlm({}) as unknown as ReturnType<typeof createLLM>);

    try {
      const item = makeRawItem();
      const result = await normalizer.normalize(item);
      assert.equal(result, 'ready');

      const { rows } = await pool.query<{
        content: string;
        content_hash: string;
        original_language: string | null;
        status: string;
        translated: boolean;
      }>(
        `SELECT content, content_hash, original_language, status, translated
           FROM items`,
      );

      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.status, 'ready');
      assert.equal(rows[0]?.translated, false);
      assert.equal(rows[0]?.original_language, 'eng');
      assert.equal(rows[0]?.content_hash, sha256(item.source + item.sourceId + item.content));
    } finally {
      await pool.end();
    }
  });

  it('normalize drops duplicate content via content_hash', async () => {
    const { pool } = setupDb();
    const logger = makeMockLogger();
    const normalizer = createNormalizer(pool, logger, config, mockLlm({}) as unknown as ReturnType<typeof createLLM>);

    try {
      const item = makeRawItem();
      const first = await normalizer.normalize(item);
      const second = await normalizer.normalize(makeRawItem({ id: 'raw-item-2' }));

      assert.equal(first, 'ready');
      assert.equal(second, 'dropped');

      const { rows } = await pool.query<{ id: string; status: string }>(
        `SELECT id, status
           FROM items
          ORDER BY id`,
      );

      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.status, 'ready');
    } finally {
      await pool.end();
    }
  });

  it('normalize filters spam content', async () => {
    const { pool } = setupDb();
    const logger = makeMockLogger();
    const normalizer = createNormalizer(pool, logger, config, mockLlm({}) as unknown as ReturnType<typeof createLLM>);

    try {
      const result = await normalizer.normalize(
        makeRawItem({
          content: 'done min semuanya',
          engagement: 1,
        }),
      );

      assert.equal(result, 'filtered');

      const { rows } = await pool.query<{ filter_reason: string | null; status: string }>(
        `SELECT filter_reason, status
           FROM items`,
      );

      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.status, 'filtered');
      assert.equal(rows[0]?.filter_reason, 'id-done-min');

      const readyRows = await pool.query<{ id: string }>(`SELECT id FROM items WHERE status = 'ready'`);
      assert.equal(readyRows.rows.length, 0);
    } finally {
      await pool.end();
    }
  });

  it('correlator detects cross-source entity mentions', async () => {
    const { pool } = setupDb();
    const logger = makeMockLogger();
    const correlator = createCorrelator(pool, logger);

    try {
      await pool.query(
        `INSERT INTO entities (id, name, type, first_seen, last_seen)
         VALUES ($1, $2, $3, $4, $4)`,
        ['entity-bitcoin', 'bitcoin', 'token', 100],
      );
      await pool.query(
        `INSERT INTO sources (source, source_id, name, trust_weight)
         VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
        ['discord', 'channel-1', 'Discord source', 1, 'rss', 'feed-1', 'RSS source', 1.1],
      );
      await pool.query(
        `INSERT INTO summaries (id, source, source_id, window_start, window_end, body, urgency, item_count, created_at)
         VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9),
         ($10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [
          'summary-1',
          'discord',
          'channel-1',
          0,
          100,
          '{}',
          'breaking',
          1,
          100,
          'summary-2',
          'rss',
          'feed-1',
          0,
          100,
          '{}',
          'breaking',
          1,
          101,
        ],
      );
      await pool.query(
        `INSERT INTO entity_mentions (id, entity_id, source, summary_id, sentiment, mention_count, created_at, language)
         VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8),
         ($9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          'mention-1',
          'entity-bitcoin',
          'discord',
          'summary-1',
          0.6,
          1,
          100,
          'eng',
          'mention-2',
          'entity-bitcoin',
          'rss',
          'summary-2',
          0.4,
          1,
          101,
          'eng',
        ],
      );

      const result = await correlator.run(0);

      assert.equal(result.correlated.length, 1);
      assert.equal(result.shouldFlash, true);
      assert.equal(result.correlated[0]?.entityName, 'bitcoin');
      assert.equal(result.correlated[0]?.urgency, 'breaking');
      assert.ok((result.correlated[0]?.weightedSum ?? 0) >= 2);
      assert.deepEqual(result.correlated[0]?.sources.map((source) => source.source).sort(), ['discord', 'rss']);
    } finally {
      await pool.end();
    }
  });

  it('summarizer runBatch processes ready items and creates summary', async () => {
    const { pool } = setupDb();
    const logger = makeMockLogger();
    const now = 5_000;
    const summaryResponse = JSON.stringify({
      summary: 'Bitcoin remained the dominant topic as traders reacted to stronger ETF momentum.',
      urgency: 'routine',
      confidence: 7,
      entities: [
        {
          name: 'Bitcoin',
          aliases: [],
          type: 'token',
          mentionCount: 2,
          sentiment: 0.6,
        },
      ],
      keyEvents: ['Bitcoin sentiment improved after ETF-related chatter picked up.'],
      events: [],
      relationships: [],
      authorClaims: [],
    });
    const llm = mockLlm({ summarize: summaryResponse });

    const entityManager = createEntityManager(pool, logger, config, llm);
    const summarizer = createSummarizer(pool, logger, config, llm, entityManager);

    try {
      await pool.query(
        `INSERT INTO sources (source, source_id, name, trust_weight)
         VALUES ($1, $2, $3, $4)`,
        ['discord', 'channel-1', 'Discord source', 1],
      );
      await pool.query(
        `INSERT INTO source_state (source, source_id, status)
         VALUES ($1, $2, $3)`,
        ['discord', 'channel-1', 'active'],
      );
      await pool.query(
        `INSERT INTO entities (id, name, type, first_seen, last_seen, relevance)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ['entity-bitcoin', 'bitcoin', 'token', now, now, 0],
      );
      await pool.query(
        `INSERT INTO entity_aliases (id, alias, context_key, entity_id, origin, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ['alias-bitcoin', 'bitcoin', '', 'entity-bitcoin', 'seed', now],
      );
      await pool.query(
        `INSERT INTO items (
          id, source, source_id, author, content, timestamp, engagement,
          content_hash, status, original_language, translated, created_at
        ) VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12),
          ($13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
        [
          'item-1',
          'discord',
          'channel-1',
          'alice',
          'Bitcoin pushed higher after another ETF rumor hit the desk.',
          1_000,
          7,
          sha256('discord' + 'channel-1' + 'Bitcoin pushed higher after another ETF rumor hit the desk.'),
          'ready',
          'eng',
          false,
          now,
          'item-2',
          'discord',
          'channel-1',
          'bob',
          'Traders kept talking about Bitcoin strength and stronger spot demand.',
          1_050,
          4,
          sha256('discord' + 'channel-1' + 'Traders kept talking about Bitcoin strength and stronger spot demand.'),
          'ready',
          'eng',
          false,
          now + 1,
        ],
      );

      const result = await summarizer.runBatch('discord', 'channel-1', 900, 1_100);

      assert.deepEqual(result, { summaryCount: 1, hasBreaking: false });

      const summaries = await pool.query<{ urgency: string | null; item_count: number }>(
        `SELECT urgency, item_count
           FROM summaries`,
      );
      assert.equal(summaries.rows.length, 1);
      assert.equal(summaries.rows[0]?.urgency, 'routine');
      assert.equal(summaries.rows[0]?.item_count, 2);

      const mentions = await pool.query<{ entity_name: string; mention_count: number }>(
        `SELECT e.name AS entity_name, em.mention_count
           FROM entity_mentions em
           JOIN entities e ON e.id = em.entity_id`,
      );
      assert.equal(mentions.rows.length, 1);
      assert.equal(mentions.rows[0]?.entity_name, 'bitcoin');
      assert.equal(mentions.rows[0]?.mention_count, 2);

      const items = await pool.query<{ id: string; status: string }>(
        `SELECT id, status
           FROM items
          ORDER BY id`,
      );
      assert.deepEqual(
        items.rows.map((row) => row.status),
        ['processed', 'processed'],
      );
    } finally {
      await pool.end();
    }
  });
});
