/**
 * Structural regression tests for Influencer Tracking 3.2 Cycle 281 — Author Extraction.
 *
 * Verifies:
 * - Summarize persistence: upsertAuthor import + author extraction logic
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
// Summarize: author extraction wiring
// ═══════════════════════════════════════════════════════════════════════

describe('Summarize persistence: author extraction wiring', () => {
  const src = readSrc('src/process/summarize-persistence.ts');

  it('imports upsertAuthor from ../db/queries.js', () => {
    assert.match(src, /upsertAuthor/);
    assert.match(src, /from\s+['"]\.\.\/db\/queries\.js['"]/);
  });

  it('builds authorsSeen map from chunk items', () => {
    assert.match(src, /authorsSeen/);
    assert.match(src, /new Map/);
  });

  it('extracts author handle from item.author', () => {
    assert.match(src, /item\.author/);
  });

  it('normalizes author handles (trim + lowercase) before upserting', () => {
    assert.match(src, /\.trim\(\)\.toLowerCase\(\)/);
  });

  it('keeps latest timestamp per author for freshness', () => {
    // Overwrites earlier timestamps with later ones via comparison
    assert.match(src, /item\.timestamp\s*>\s*prev/);
  });

  it('calls upsertAuthor with pool, source (platform), handle, null displayName, timestamp', () => {
    assert.match(src, /upsertAuthor\(pool,\s*source,\s*handle,\s*null,\s*timestamp\)/);
  });

  it('wraps author extraction in try/catch for resilience', () => {
    assert.match(src, /try\s*\{[\s\S]*?authorsSeen[\s\S]*?\}\s*catch/);
  });

  it('logs warning on author upsert failure', () => {
    assert.match(src, /Author upsert failed/);
  });

  it('uses Promise.all for parallel author upserts', () => {
    // The upsertAuthor calls are parallelized
    assert.match(src, /Promise\.all[\s\S]*?upsertAuthor/);
  });
});
