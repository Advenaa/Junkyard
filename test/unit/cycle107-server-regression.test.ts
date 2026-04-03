/**
 * Structural regression tests for cycle 107: SR-008
 *
 * SR-008: Search endpoint gains `days` and `mode` query params.
 * The /api/v1/search route schema now defines days (integer, 1-365)
 * and mode (enum: keyword | semantic). Handler defaults mode to 'keyword',
 * returns 501 for semantic, defaults days to 30 clamped [1, 365], and
 * computes cutoff from the days variable.
 */
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
// SR-008: Search endpoint gains `days` and `mode` query params
// ===========================================================================

describe('SR-008: Search endpoint days and mode query params', () => {
  const src = readSrc('src/server.ts');

  // --- Schema assertions ---

  it('search schema includes days property with integer type', () => {
    assert.match(
      src,
      /days:\s*\{\s*type:\s*'integer'/,
      'Search schema must define days with type integer',
    );
  });

  it('search schema defines days minimum: 1, maximum: 365', () => {
    assert.match(
      src,
      /days:\s*\{[^}]*minimum:\s*1/,
      'Search schema days must have minimum: 1',
    );
    assert.match(
      src,
      /days:\s*\{[^}]*maximum:\s*365/,
      'Search schema days must have maximum: 365',
    );
  });

  it('search schema includes mode property with enum keyword and semantic', () => {
    assert.match(
      src,
      /mode:\s*\{\s*type:\s*'string',\s*enum:\s*\['keyword',\s*'semantic'\]/,
      'Search schema must define mode with enum [keyword, semantic]',
    );
  });

  // --- Handler assertions ---

  it('handler destructures days as rawDays and mode as rawMode', () => {
    assert.match(
      src,
      /days:\s*rawDays/,
      'Handler must destructure days: rawDays',
    );
    assert.match(
      src,
      /mode:\s*rawMode/,
      'Handler must destructure mode: rawMode',
    );
  });

  it('handler defaults mode to keyword when not provided', () => {
    assert.ok(
      src.includes("const mode = rawMode ?? 'keyword'"),
      "Handler must default mode to 'keyword' via rawMode ?? 'keyword'",
    );
  });

  it('semantic mode returns 501 error', () => {
    assert.ok(
      src.includes("reply.code(501).send({ error: 'semantic search is only available via the chat interface' })"),
      'Handler must return 501 with semantic search error message',
    );
  });

  it('days defaults to 30 and is clamped to [1, 365]', () => {
    assert.ok(
      src.includes('Math.min(Math.max(rawDays ?? 30, 1), 365)'),
      'Handler must clamp days with Math.min(Math.max(rawDays ?? 30, 1), 365)',
    );
  });

  it('cutoff is computed from days variable, not hardcoded 30', () => {
    assert.ok(
      src.includes('new Date(Date.now() - days * 24 * 60 * 60 * 1000)'),
      'Cutoff must use days variable: new Date(Date.now() - days * 24 * 60 * 60 * 1000)',
    );
    // Ensure no hardcoded 30-day cutoff
    assert.doesNotMatch(
      src,
      /new Date\(Date\.now\(\)\s*-\s*30\s*\*\s*24/,
      'Cutoff must NOT use hardcoded 30 — must reference the days variable',
    );
  });
});
