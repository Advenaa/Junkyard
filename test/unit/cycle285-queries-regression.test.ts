/**
 * Cycle 285 structural regression tests for DC-020.
 *
 * DC-020: insertItem must match the partial unique index on items.content_hash
 * or Discord normalize writes fail with "no unique or exclusion constraint
 * matching the ON CONFLICT specification".
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const queriesSrc = readFileSync(new URL('../../src/db/queries.ts', import.meta.url), 'utf-8');
const migrationsSrc = readFileSync(new URL('../../src/db/migrations.ts', import.meta.url), 'utf-8');

describe('DC-020 — insertItem conflict target matches the partial content-hash index', () => {
  it('defines the partial unique index on content_hash', () => {
    assert.match(
      migrationsSrc,
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_items_content_hash[\s\S]*ON items\(content_hash\) WHERE content_hash IS NOT NULL/,
      'migrations.ts must define idx_items_content_hash as a partial unique index on non-null content_hash',
    );
  });

  it('uses the same partial predicate in insertItem ON CONFLICT', () => {
    const fnStart = queriesSrc.indexOf('export async function insertItem');
    assert.ok(fnStart !== -1, 'queries.ts must export insertItem');

    const fnBody = queriesSrc.slice(fnStart, fnStart + 1200);
    assert.match(
      fnBody,
      /ON CONFLICT \(content_hash\) WHERE content_hash IS NOT NULL DO NOTHING/,
      'insertItem must include the partial-index predicate in ON CONFLICT to match idx_items_content_hash',
    );
  });
});
