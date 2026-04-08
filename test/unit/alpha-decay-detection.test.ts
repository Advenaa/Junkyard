/**
 * Structural regression tests for the Alpha Decay 3.6 Detection cycle.
 *
 * Verifies:
 * - Alpha tracker module exists with correct shape and wiring
 * - Entity manager returns entity IDs for alpha tracking
 * - Summarizer accepts and invokes alpha tracker
 * - Index.ts wires alpha tracker into the pipeline
 *
 * These tests read source files as strings and use regex/string matching --
 * they do NOT import or execute the modules.
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

// ═══════════════════════════════════════════════════════════════════════
// 1. Alpha tracker module shape
// ═══════════════════════════════════════════════════════════════════════

describe('Alpha tracker module shape (src/knowledge/alpha-tracker.ts)', () => {
  const src = readSrc('src/knowledge/alpha-tracker.ts');

  it('exports createAlphaTracker function', () => {
    assert.match(src, /export\s+function\s+createAlphaTracker/);
  });

  it('exports AlphaTracker interface', () => {
    assert.match(src, /export\s+interface\s+AlphaTracker/);
  });

  it('imports insertAlphaPropagation from ../db/queries.js', () => {
    assert.ok(src.includes('insertAlphaPropagation'));
    assert.match(src, /import\s+.*insertAlphaPropagation.*from\s+['"]\.\.\/db\/queries\.js['"]/);
  });

  it('imports Pool from ../db/connection.js', () => {
    assert.match(src, /import\s+.*Pool.*from\s+['"]\.\.\/db\/connection\.js['"]/);
  });

  it('defines ALPHA_LOOKBACK_MS constant', () => {
    assert.match(src, /ALPHA_LOOKBACK_MS/);
  });

  it('has trackMentions method', () => {
    assert.ok(src.includes('trackMentions'));
  });

  it('queries source tier (SELECT tier FROM sources)', () => {
    assert.match(src, /SELECT\s+tier\s+FROM\s+sources/i);
  });

  it('checks existing alpha_propagation records (SELECT DISTINCT entity_id FROM alpha_propagation)', () => {
    assert.match(src, /SELECT\s+DISTINCT\s+entity_id\s+FROM\s+alpha_propagation/i);
  });

  it('wraps tracking in try/catch for error resilience', () => {
    assert.match(src, /try\s*\{[\s\S]*?catch\s*\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Entity manager returns entity IDs
// ═══════════════════════════════════════════════════════════════════════

describe('Entity manager returns entity IDs (src/knowledge/entities.ts)', () => {
  const src = readSrc('src/knowledge/entities.ts');

  it('resolveEntities return type includes string[] (Promise<string[]>)', () => {
    assert.match(src, /resolveEntities[\s\S]*?Promise<string\[\]>/);
  });

  it('collects resolved entity IDs from entityIdMap', () => {
    assert.ok(src.includes('entityIdMap.values()') || (src.includes('entityIdMap') && src.includes('resolvedIds')));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Summarizer accepts alpha tracker
// ═══════════════════════════════════════════════════════════════════════

describe('Summarizer accepts alpha tracker (src/process/summarize.ts)', () => {
  const src = readSrc('src/process/summarize.ts');

  it('imports AlphaTracker from ../knowledge/alpha-tracker.js', () => {
    assert.match(src, /import\s+.*AlphaTracker.*from\s+['"]\.\.\/knowledge\/alpha-tracker\.js['"]/);
  });

  it('createSummarizer signature includes alphaTracker parameter', () => {
    assert.match(src, /createSummarizer\s*\([^)]*alphaTracker/);
  });

  it('calls alphaTracker.trackMentions after entity resolution', () => {
    assert.ok(src.includes('alphaTracker.trackMentions'));
  });

  it('alpha tracker call is wrapped in try/catch', () => {
    // Verify there's a try/catch around alphaTracker usage
    assert.match(src, /try\s*\{[\s\S]*?alphaTracker[\s\S]*?catch|alphaTracker[\s\S]*?try\s*\{[\s\S]*?catch/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Index.ts wiring
// ═══════════════════════════════════════════════════════════════════════

describe('Index.ts wiring (src/index.ts)', () => {
  const src = readSrc('src/index.ts');

  it('imports createAlphaTracker from ./knowledge/alpha-tracker.js', () => {
    assert.match(src, /import\s+.*createAlphaTracker.*from\s+['"]\.\/knowledge\/alpha-tracker\.js['"]/);
  });

  it('creates alphaTracker instance with createAlphaTracker(pool', () => {
    assert.match(src, /createAlphaTracker\s*\(\s*pool/);
  });

  it('passes alphaTracker to createSummarizer', () => {
    assert.match(src, /createSummarizer\s*\([^)]*alphaTracker/);
  });
});
