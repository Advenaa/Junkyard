/**
 * Structural regression tests for cycle 107 findings.
 *
 * EL-008: keyword_search uses normalizeAlias for $BTC lookup via entity_aliases join
 * EL-012: TOP_SYMBOLS replaces dead market_cap_rank code for context_key decisions
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
// EL-008: keyword_search uses normalizeAlias for $BTC lookup
// ===========================================================================

describe('EL-008: keyword_search normalizes aliases before querying', () => {
  const src = readSrc('src/chat/tools.ts');

  it('imports normalizeAlias from ../knowledge/entities.js', () => {
    assert.match(
      src,
      /import\s*\{[^}]*normalizeAlias[^}]*\}\s*from\s*['"]\.\.\/knowledge\/entities\.js['"]/,
      'tools.ts must import normalizeAlias from ../knowledge/entities.js',
    );
  });

  it('calls normalizeAlias(entity) in the keyword_search function', () => {
    assert.match(src, /normalizeAlias\(entity\)/, 'keyword_search must call normalizeAlias(entity) before querying');
  });

  it('query joins entity_aliases ea ON ea.entity_id = e.id', () => {
    assert.ok(
      src.includes('entity_aliases ea ON ea.entity_id = e.id'),
      'keyword_search query must join entity_aliases ea ON ea.entity_id = e.id',
    );
  });

  it('WHERE clause uses ea.alias = $1', () => {
    assert.ok(src.includes('ea.alias = $1'), 'keyword_search WHERE clause must use ea.alias = $1');
  });
});

// ===========================================================================
// EL-012: TOP_SYMBOLS replaces dead market_cap_rank code
// ===========================================================================

describe('EL-012: TOP_SYMBOLS drives context_key instead of market_cap_rank', () => {
  const src = readSrc('src/knowledge/seed.ts');

  it('defines TOP_SYMBOLS as a new Set', () => {
    assert.match(src, /TOP_SYMBOLS\s*=\s*new\s+Set\(\[/, 'TOP_SYMBOLS must be defined as new Set([');
  });

  it("TOP_SYMBOLS contains 'btc'", () => {
    assert.match(src, /['"]btc['"]/, "TOP_SYMBOLS must contain 'btc'");
  });

  it("TOP_SYMBOLS contains 'eth'", () => {
    assert.match(src, /['"]eth['"]/, "TOP_SYMBOLS must contain 'eth'");
  });

  it("TOP_SYMBOLS contains 'sol'", () => {
    assert.match(src, /['"]sol['"]/, "TOP_SYMBOLS must contain 'sol'");
  });

  it('uses TOP_SYMBOLS.has(symbolAlias) to decide context_key', () => {
    assert.match(src, /TOP_SYMBOLS\.has\(symbolAlias\)/, 'context_key decision must use TOP_SYMBOLS.has(symbolAlias)');
  });

  it("assigns empty context_key '' for top symbols", () => {
    // The ternary: TOP_SYMBOLS.has(symbolAlias) ? '' : `coingecko:${coin.id}`
    assert.match(src, /TOP_SYMBOLS\.has\(symbolAlias\)\s*\?\s*['"]['"]/, "top symbols must get empty context_key ''");
  });

  it('assigns coingecko:${coin.id} context_key for non-top symbols', () => {
    assert.ok(src.includes('`coingecko:${coin.id}`'), 'non-top symbols must get coingecko:${coin.id} as context_key');
  });

  it('does not use market_cap_rank for context_key decisions', () => {
    // Extract the block around TOP_SYMBOLS.has and context_key assignment
    const contextKeyBlock = src.slice(
      src.indexOf('TOP_SYMBOLS.has(symbolAlias)'),
      src.indexOf('TOP_SYMBOLS.has(symbolAlias)') + 200,
    );
    assert.ok(
      !contextKeyBlock.includes('market_cap_rank'),
      'context_key decision logic must not reference market_cap_rank',
    );
  });
});
