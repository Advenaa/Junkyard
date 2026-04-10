import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

// ===========================================================================
// CD-002: PATCH /sources/:source/:sourceId endpoint exists
// ===========================================================================

describe('CD-002: PATCH /sources/:source/:sourceId', () => {
  const src = readSrc('src/server.ts');

  it('registers a PATCH route for /sources/:source/:sourceId', () => {
    const pattern = /app\.patch\(\s*['"]\/api\/v1\/sources\/:source\/:sourceId['"]/;
    assert.match(src, pattern, 'PATCH /api/v1/sources/:source/:sourceId route must be registered');
  });

  it('route requires admin access', () => {
    // Find the PATCH /sources route block and check for requireAdmin
    const block = src.match(
      /app\.patch\(\s*['"]\/api\/v1\/sources\/:source\/:sourceId['"][^)]*\{[^}]*preHandler\s*:\s*\[([^\]]*)\]/s,
    );
    assert.ok(block, 'PATCH /sources route must have preHandler');
    assert.ok(block![1].includes('requireAdmin'), 'PATCH /sources must require admin');
  });
});

// ===========================================================================
// CD-003: PATCH /users/:discordId endpoint exists
// ===========================================================================

describe('CD-003: PATCH /users/:discordId', () => {
  const src = readSrc('src/server.ts');

  it('registers a PATCH route for /users/:discordId', () => {
    const pattern = /app\.patch\(\s*['"]\/api\/v1\/users\/:discordId['"]/;
    assert.match(src, pattern, 'PATCH /api/v1/users/:discordId route must be registered');
  });

  it('route requires admin access', () => {
    const block = src.match(
      /app\.patch\(\s*['"]\/api\/v1\/users\/:discordId['"][^)]*\{[^}]*preHandler\s*:\s*\[([^\]]*)\]/s,
    );
    assert.ok(block, 'PATCH /users route must have preHandler');
    assert.ok(block![1].includes('requireAdmin'), 'PATCH /users must require admin');
  });
});

// ===========================================================================
// CD-004: GET /api/v1/status endpoint exists
// ===========================================================================

describe('CD-004: GET /api/v1/status', () => {
  const src = readSrc('src/server.ts');

  it('registers a GET route for /api/v1/status', () => {
    const pattern = /app\.get\(\s*['"]\/api\/v1\/status['"]/;
    assert.match(src, pattern, 'GET /api/v1/status route must be registered');
  });
});

// ===========================================================================
// CD-005: POST /api/v1/config/test-webhook endpoint exists
// ===========================================================================

describe('CD-005: POST /api/v1/config/test-webhook', () => {
  const src = readSrc('src/server.ts');

  it('registers a POST route for /api/v1/config/test-webhook', () => {
    const pattern = /app\.post\(\s*['"]\/api\/v1\/config\/test-webhook['"]/;
    assert.match(src, pattern, 'POST /api/v1/config/test-webhook route must be registered');
  });

  it('route requires admin access', () => {
    const block = src.match(
      /app\.post\(\s*['"]\/api\/v1\/config\/test-webhook['"][^)]*\{[^}]*preHandler\s*:\s*\[([^\]]*)\]/s,
    );
    assert.ok(block, 'POST /config/test-webhook route must have preHandler');
    assert.ok(block![1].includes('requireAdmin'), 'POST /config/test-webhook must require admin');
  });
});

// ===========================================================================
// CD-012: getAllSourcesWithState JOINs source_state
// ===========================================================================

describe('CD-012: getAllSourcesWithState query', () => {
  const src = readSrc('src/db/queries.ts');

  it('exports getAllSourcesWithState function', () => {
    assert.match(
      src,
      /export\s+(async\s+)?function\s+getAllSourcesWithState/,
      'getAllSourcesWithState must be exported',
    );
  });

  it('query uses LEFT JOIN source_state', () => {
    assert.match(src, /LEFT\s+JOIN\s+source_state/, 'getAllSourcesWithState must LEFT JOIN source_state');
  });

  it('query selects source_state columns', () => {
    // Should select state columns like last_fetched_at, error_count, last_error
    assert.match(src, /ss\.last_fetched_at/, 'query must select ss.last_fetched_at');
    assert.match(src, /ss\.error_count/, 'query must select ss.error_count');
    assert.match(src, /ss\.last_error/, 'query must select ss.last_error');
  });

  it('server.ts imports getAllSourcesWithState', () => {
    const serverSrc = readSrc('src/server.ts');
    assert.match(serverSrc, /getAllSourcesWithState/, 'server.ts must import getAllSourcesWithState');
  });
});

// ===========================================================================
// SY-001: dateToEpochMsBounds accepts timezone parameter
// ===========================================================================

describe('SY-001: Sentiment timezone fix', () => {
  const src = readSrc('src/knowledge/sentiment.ts');

  it('dateToEpochMsBounds accepts a timezone parameter', () => {
    // Function signature: dateToEpochMsBounds(dateString: string, timezone: string)
    const pattern = /function\s+dateToEpochMsBounds\s*\(\s*dateString\s*:\s*string\s*,\s*timezone\s*:\s*string\s*\)/;
    assert.match(src, pattern, 'dateToEpochMsBounds must accept (dateString: string, timezone: string)');
  });

  it('uses timezone parameter for offset computation', () => {
    // Should reference the timezone parameter in toLocaleString or similar
    assert.match(src, /timeZone/, 'dateToEpochMsBounds must use timeZone for offset computation');
  });
});

// ===========================================================================
// AE-002: Migration 13 widens epoch-ms columns to BIGINT
// ===========================================================================

describe('AE-002: Migration 13 BIGINT', () => {
  const src = readSrc('src/db/migrations.ts');

  it('has a migration that alters columns to BIGINT', () => {
    assert.match(src, /ALTER.*TYPE\s+BIGINT/i, 'migrations must contain ALTER ... TYPE BIGINT');
  });

  it('migration comment references AE-002', () => {
    assert.match(src, /AE-002/, 'migration must reference AE-002 in a comment');
  });

  it('alters sources.added_at to BIGINT', () => {
    assert.match(
      src,
      /ALTER\s+TABLE\s+sources\s+ALTER\s+COLUMN\s+added_at\s+TYPE\s+BIGINT/i,
      'sources.added_at must be widened to BIGINT',
    );
  });

  it('alters items.timestamp to BIGINT', () => {
    assert.match(
      src,
      /ALTER\s+TABLE\s+items\s+ALTER\s+COLUMN\s+timestamp\s+TYPE\s+BIGINT/i,
      'items.timestamp must be widened to BIGINT',
    );
  });

  it('alters items.created_at to BIGINT', () => {
    assert.match(
      src,
      /ALTER\s+TABLE\s+items\s+ALTER\s+COLUMN\s+created_at\s+TYPE\s+BIGINT/i,
      'items.created_at must be widened to BIGINT',
    );
  });

  it('alters sessions.expires_at to BIGINT', () => {
    assert.match(
      src,
      /ALTER\s+TABLE\s+sessions\s+ALTER\s+COLUMN\s+expires_at\s+TYPE\s+BIGINT/i,
      'sessions.expires_at must be widened to BIGINT',
    );
  });

  it('alters reports.created_at to BIGINT', () => {
    assert.match(
      src,
      /ALTER\s+TABLE\s+reports\s+ALTER\s+COLUMN\s+created_at\s+TYPE\s+BIGINT/i,
      'reports.created_at must be widened to BIGINT',
    );
  });

  it('covers all major tables with epoch-ms columns', () => {
    const tables = [
      'sources',
      'source_state',
      'source_rate_history',
      'items',
      'summaries',
      'entities',
      'entity_mentions',
      'reports',
      'users',
      'sessions',
      'llm_usage',
      'health_events',
      'narratives',
      'embeddings',
    ];
    for (const table of tables) {
      const pattern = new RegExp(`ALTER\\s+TABLE\\s+${table}\\s+ALTER\\s+COLUMN\\s+\\w+\\s+TYPE\\s+BIGINT`, 'i');
      assert.match(src, pattern, `${table} must have at least one column widened to BIGINT`);
    }
  });
});

// ===========================================================================
// M-085: Migration 34 partial index on entity_mentions(sentiment IS NOT NULL)
// ===========================================================================

describe('M-085: Migration 34 partial index on entity_mentions', () => {
  const src = readSrc('src/db/migrations.ts');

  it('migration references M-085', () => {
    assert.match(src, /M-085/, 'migration must reference M-085 in a comment');
  });

  it('creates idx_mentions_sentiment_ts as a partial index', () => {
    assert.match(
      src,
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_mentions_sentiment_ts\s+ON\s+entity_mentions\s*\(\s*created_at\s*,\s*entity_id\s*\)\s+WHERE\s+sentiment\s+IS\s+NOT\s+NULL/i,
      'idx_mentions_sentiment_ts must be a partial index filtered by sentiment IS NOT NULL',
    );
  });
});
