/**
 * Structural regression tests for Influencer Tracking 3.2 Foundation (Cycle 280).
 *
 * Reads source files as strings and verifies:
 * - Migration 29 creates authors + author_calls tables with correct schema
 * - Author query functions are exported in queries.ts
 * - Server exposes author API endpoints with correct auth + error handling
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readServerSource } from './helpers/server-source.js';
import { readQueriesSource } from './helpers/queries-source.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

// ═══════════════════════════════════════════════════════════════════════
// migrations.ts — Migration 29: author tracking tables
// ═══════════════════════════════════════════════════════════════════════

describe('Migration 29: author tracking tables (src/db/migrations.ts)', () => {
  const src = readSrc('src/db/migrations.ts');

  it('creates authors table', () => {
    assert.match(src, /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?authors\s*\(/i, 'Migration must CREATE TABLE authors');
  });

  it('creates author_calls table', () => {
    assert.match(
      src,
      /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?author_calls\s*\(/i,
      'Migration must CREATE TABLE author_calls',
    );
  });

  it('authors has platform and handle columns', () => {
    const tableStart = src.indexOf('CREATE TABLE');
    const authorsStart = src.indexOf('authors', src.indexOf('CREATE TABLE IF NOT EXISTS authors'));
    assert.ok(authorsStart !== -1, 'authors table must exist');
    const tableSlice = src.slice(authorsStart, authorsStart + 800);

    assert.match(tableSlice, /platform\s+TEXT/i, 'authors must have platform TEXT column');
    assert.match(tableSlice, /handle\s+TEXT/i, 'authors must have handle TEXT column');
  });

  it('authors has credibility_score column', () => {
    const authorsStart = src.indexOf('authors', src.indexOf('CREATE TABLE IF NOT EXISTS authors'));
    assert.ok(authorsStart !== -1, 'authors table must exist');
    const tableSlice = src.slice(authorsStart, authorsStart + 800);

    assert.match(tableSlice, /credibility_score\s+REAL/i, 'authors must have credibility_score REAL column');
  });

  it('author_calls has claim_type CHECK constraint (bullish, bearish, event, neutral)', () => {
    const callsStart = src.indexOf('author_calls', src.indexOf('CREATE TABLE IF NOT EXISTS author_calls'));
    assert.ok(callsStart !== -1, 'author_calls table must exist');
    const tableSlice = src.slice(callsStart, callsStart + 1200);

    assert.match(
      tableSlice,
      /claim_type\s+TEXT\s+NOT\s+NULL\s+CHECK/i,
      'author_calls must have claim_type with CHECK constraint',
    );
    assert.ok(
      tableSlice.includes('bullish') &&
        tableSlice.includes('bearish') &&
        tableSlice.includes('event') &&
        tableSlice.includes('neutral'),
      'claim_type CHECK must include bullish, bearish, event, neutral',
    );
  });

  it('author_calls has author_id FK to authors', () => {
    const callsStart = src.indexOf('author_calls', src.indexOf('CREATE TABLE IF NOT EXISTS author_calls'));
    assert.ok(callsStart !== -1, 'author_calls table must exist');
    const tableSlice = src.slice(callsStart, callsStart + 1200);

    assert.match(
      tableSlice,
      /author_id\s+TEXT\s+NOT\s+NULL\s+REFERENCES\s+authors/i,
      'author_calls must have author_id FK to authors',
    );
  });

  it('author_calls has entity_id FK to entities', () => {
    const callsStart = src.indexOf('author_calls', src.indexOf('CREATE TABLE IF NOT EXISTS author_calls'));
    assert.ok(callsStart !== -1, 'author_calls table must exist');
    const tableSlice = src.slice(callsStart, callsStart + 1200);

    assert.match(
      tableSlice,
      /entity_id\s+TEXT\s+NOT\s+NULL\s+REFERENCES\s+entities/i,
      'author_calls must have entity_id FK to entities',
    );
  });

  it('has unique index on authors (platform, handle)', () => {
    assert.match(
      src,
      /CREATE\s+UNIQUE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?\w+\s+ON\s+authors\s*\(\s*platform\s*,\s*handle\s*\)/i,
      'Must have a UNIQUE INDEX on authors(platform, handle)',
    );
  });

  it('author_calls has resolved column', () => {
    const callsStart = src.indexOf('author_calls', src.indexOf('CREATE TABLE IF NOT EXISTS author_calls'));
    assert.ok(callsStart !== -1, 'author_calls table must exist');
    const tableSlice = src.slice(callsStart, callsStart + 1200);

    assert.match(tableSlice, /resolved\s+BOOLEAN/i, 'author_calls must have resolved BOOLEAN column');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// queries.ts — Author query functions
// ═══════════════════════════════════════════════════════════════════════

describe('Author queries (src/db/queries.ts)', () => {
  const src = readQueriesSource();

  it('exports AuthorRow interface', () => {
    assert.match(src, /export\s+(interface|type)\s+AuthorRow\b/, 'AuthorRow must be an exported interface or type');
  });

  it('exports AuthorCallRow interface', () => {
    assert.match(
      src,
      /export\s+(interface|type)\s+AuthorCallRow\b/,
      'AuthorCallRow must be an exported interface or type',
    );
  });

  it('exports upsertAuthor function', () => {
    assert.match(src, /export\s+(async\s+)?function\s+upsertAuthor\s*\(/, 'upsertAuthor must be an exported function');
  });

  it('exports getAuthorByHandle function', () => {
    assert.match(
      src,
      /export\s+(async\s+)?function\s+getAuthorByHandle\s*\(/,
      'getAuthorByHandle must be an exported function',
    );
  });

  it('exports getAuthorById function', () => {
    assert.match(
      src,
      /export\s+(async\s+)?function\s+getAuthorById\s*\(/,
      'getAuthorById must be an exported function',
    );
  });

  it('exports getTopAuthorsByEntity function', () => {
    assert.match(
      src,
      /export\s+(async\s+)?function\s+getTopAuthorsByEntity\s*\(/,
      'getTopAuthorsByEntity must be an exported function',
    );
  });

  it('exports insertAuthorCall function', () => {
    assert.match(
      src,
      /export\s+(async\s+)?function\s+insertAuthorCall\s*\(/,
      'insertAuthorCall must be an exported function',
    );
  });

  it('exports getAuthorCalls function', () => {
    assert.match(
      src,
      /export\s+(async\s+)?function\s+getAuthorCalls\s*\(/,
      'getAuthorCalls must be an exported function',
    );
  });

  it('does not export getUnresolvedCalls function', () => {
    assert.doesNotMatch(
      src,
      /export\s+(async\s+)?function\s+getUnresolvedCalls\s*\(/,
      'getUnresolvedCalls must not be exported',
    );
  });

  it('does not export resolveAuthorCall function', () => {
    assert.doesNotMatch(
      src,
      /export\s+(async\s+)?function\s+resolveAuthorCall\s*\(/,
      'resolveAuthorCall must not be exported',
    );
  });

  it('upsertAuthor uses ON CONFLICT (platform, handle)', () => {
    const fnStart = src.indexOf('function upsertAuthor');
    assert.ok(fnStart !== -1, 'upsertAuthor must exist');
    const fnSlice = src.slice(fnStart, fnStart + 800);

    assert.match(
      fnSlice,
      /ON\s+CONFLICT\s*\(\s*platform\s*,\s*handle\s*\)/i,
      'upsertAuthor must use ON CONFLICT (platform, handle)',
    );
  });

  it('getAuthorCalls omits manual grading columns', () => {
    const fnStart = src.indexOf('function getAuthorCalls');
    assert.ok(fnStart !== -1, 'getAuthorCalls must exist');
    const fnSlice = src.slice(fnStart, fnStart + 800);

    assert.ok(!fnSlice.includes('outcome'), 'getAuthorCalls must not select outcome');
    assert.ok(!fnSlice.includes('resolved_at'), 'getAuthorCalls must not select resolved_at');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// server.ts — Author API endpoints
// ═══════════════════════════════════════════════════════════════════════

describe('Server: author API endpoints (src/server.ts)', () => {
  const src = readServerSource();

  it('imports getTopAuthorsByEntity', () => {
    assert.ok(src.includes('getTopAuthorsByEntity'), 'server.ts must import getTopAuthorsByEntity');
  });

  it('imports getAuthorById', () => {
    assert.ok(src.includes('getAuthorById'), 'server.ts must import getAuthorById');
  });

  it('imports getAuthorCalls', () => {
    assert.ok(src.includes('getAuthorCalls'), 'server.ts must import getAuthorCalls');
  });

  it('has route /api/v1/entities/:entityId/authors', () => {
    assert.ok(
      src.includes('/api/v1/entities/:entityId/authors'),
      'server.ts must have route /api/v1/entities/:entityId/authors',
    );
  });

  it('has route /api/v1/authors/:authorId', () => {
    assert.ok(src.includes('/api/v1/authors/:authorId'), 'server.ts must have route /api/v1/authors/:authorId');
  });

  it('entity authors route uses authPreHandler', () => {
    // Find the entity authors route and check it uses authPreHandler
    const routeStart = src.indexOf('/api/v1/entities/:entityId/authors');
    assert.ok(routeStart !== -1, 'entity authors route must exist');
    // authPreHandler should appear in the route config before the route path
    const routeContext = src.slice(Math.max(0, routeStart - 300), routeStart + 100);
    assert.ok(routeContext.includes('authPreHandler'), 'entity authors route must use authPreHandler');
  });

  it('author profile route returns 404 when not found', () => {
    // Find the author profile route and check for 404 handling
    const routeStart = src.indexOf('/api/v1/authors/:authorId');
    assert.ok(routeStart !== -1, 'author profile route must exist');
    const routeSlice = src.slice(routeStart, routeStart + 1200);
    assert.ok(
      routeSlice.includes('404') || routeSlice.includes('not found') || routeSlice.includes('Not found'),
      'author profile route must return 404 when author not found',
    );
  });
});
