/**
 * Structural regression tests for cycle 107: EL-004
 *
 * EL-004: Tier 2 co-occurrence disambiguation includes archived entities
 * and resurrects them back to active status with relevance = 0.5.
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
// EL-004: Tier 2 includes archived entities and resurrects them
// ===========================================================================

describe('EL-004: Tier 2 co-occurrence resurrects archived entities', () => {
  const src = readSrc('src/knowledge/entities.ts');

  it('Tier 2 query selects e.status from entities table', () => {
    assert.match(
      src,
      /SELECT DISTINCT\s+ea\.alias,\s*ea\.entity_id,\s*e\.type,\s*e\.status/,
      'Tier 2 co-occurrence query must select e.status',
    );
  });

  it('Tier 2 query joins entities table', () => {
    assert.match(
      src,
      /JOIN\s+entities\s+e\s+ON\s+e\.id\s*=\s*ea\.entity_id/,
      'Tier 2 co-occurrence query must join entities e ON e.id = ea.entity_id',
    );
  });

  it('coOccurMap stores objects with entityId and status fields', () => {
    assert.match(
      src,
      /coOccurMap\.set\([^)]+\{\s*entityId:\s*row\.entity_id,\s*status:\s*row\.status\s*\}/,
      'coOccurMap must store { entityId, status } objects',
    );
  });

  it('checks if Tier 2 match has archived status', () => {
    assert.match(
      src,
      /if\s*\(\s*match\.status\s*===\s*'archived'\s*\)/,
      'Must check if (match.status === \'archived\') for Tier 2 matches',
    );
  });

  it('resurrection UPDATE sets status to active preserving prior relevance', () => {
    assert.match(
      src,
      /UPDATE\s+entities\s+SET\s+status\s*=\s*'active',\s*relevance\s*=\s*GREATEST\(relevance,\s*0\.5\)\s+WHERE\s+id\s*=\s*\$1/,
      'Resurrection UPDATE must set status = \'active\', relevance = GREATEST(relevance, 0.5)',
    );
  });

  it('logs reactivation of archived entity via Tier 2', () => {
    assert.ok(
      src.includes('reactivated archived entity via Tier 2 co-occurrence'),
      'Must log "reactivated archived entity via Tier 2 co-occurrence"',
    );
  });
});
