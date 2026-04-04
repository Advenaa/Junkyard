/**
 * Structural regression tests for cycle 118 entity fixes.
 *
 * EL-002: Resurrection uses GREATEST(relevance, 0.5) instead of hard-set
 * EL-005: Entity mention created on resurrection (Tier 1 + Tier 2)
 * EL-007: CoinGecko seeding has retry logic with backoff
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
// EL-002: Resurrection uses GREATEST(relevance, 0.5) not hard-set
// ===========================================================================

describe('EL-002: Resurrection preserves higher relevance via GREATEST', () => {
  const src = readSrc('src/knowledge/entities.ts');

  it('Tier 1 resurrection UPDATE uses GREATEST(relevance, 0.5)', () => {
    // Find the Tier 1 section (alias lookup) and check its UPDATE
    const tier1Section = src.split('Tier 2')[0];
    assert.match(
      tier1Section,
      /GREATEST\(relevance,\s*0\.5\)/,
      'Tier 1 resurrection must use GREATEST(relevance, 0.5), not relevance = 0.5',
    );
  });

  it('Tier 2 resurrection UPDATE uses GREATEST(relevance, 0.5)', () => {
    // Find the Tier 2 section and check its UPDATE
    const tier2Section = src.split('Tier 2')[1];
    assert.ok(tier2Section, 'Source must contain a Tier 2 section');
    assert.match(
      tier2Section,
      /GREATEST\(relevance,\s*0\.5\)/,
      'Tier 2 resurrection must use GREATEST(relevance, 0.5), not relevance = 0.5',
    );
  });
});

// ===========================================================================
// EL-005: Entity mention INSERT on resurrection
// ===========================================================================

describe('EL-005: Resurrection creates entity_mentions record', () => {
  const src = readSrc('src/knowledge/entities.ts');

  it('Tier 1 resurrection inserts into entity_mentions', () => {
    // The INSERT INTO entity_mentions must appear near the Tier 1 resurrection UPDATE
    const tier1Section = src.split('Tier 2')[0];
    assert.ok(
      tier1Section.includes("status === 'archived'"),
      'Tier 1 must check for archived status',
    );
    assert.ok(
      tier1Section.includes('INSERT INTO entity_mentions'),
      'Tier 1 resurrection must INSERT INTO entity_mentions to record the mention',
    );
  });

  it('Tier 2 resurrection inserts into entity_mentions', () => {
    const tier2Section = src.split('Tier 2')[1];
    assert.ok(tier2Section, 'Source must contain a Tier 2 section');
    // After the archived check in Tier 2, there must be an entity_mentions INSERT
    const archivedIdx = tier2Section.indexOf("match.status === 'archived'");
    assert.ok(archivedIdx !== -1, 'Tier 2 must check match.status === archived');
    const afterArchived = tier2Section.slice(archivedIdx);
    assert.ok(
      afterArchived.includes('INSERT INTO entity_mentions'),
      'Tier 2 resurrection must INSERT INTO entity_mentions after archived check',
    );
  });
});

// ===========================================================================
// EL-007: CoinGecko seeding has retry logic
// ===========================================================================

describe('EL-007: CoinGecko seeding retries on failure', () => {
  const src = readSrc('src/knowledge/seed.ts');

  it('defines a retry count constant and attempt loop', () => {
    assert.match(
      src,
      /MAX_RETRIES\s*=\s*\d+/,
      'Must define a MAX_RETRIES constant',
    );
    assert.match(
      src,
      /for\s*\(\s*let\s+attempt\s*=\s*1;\s*attempt\s*<=\s*MAX_RETRIES/,
      'Must have a retry loop using attempt variable up to MAX_RETRIES',
    );
  });

  it('sleeps between retries with exponential backoff', () => {
    assert.match(
      src,
      /setTimeout\(resolve,\s*\w+\)/,
      'Must use setTimeout for delay between retries',
    );
    assert.match(
      src,
      /2\s*\*\*\s*\(attempt\s*-\s*1\)/,
      'Must use exponential backoff (2 ** (attempt - 1))',
    );
  });
});
