/**
 * Cycle 113 structural regression tests
 *
 * SD-016 — Advisory lock prevents onDaily/catch-up race
 * SD-012 — Pulse uses alias-aware entity lookup
 * SD-015 — Correlation cutoff uses >= instead of >
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');

const indexSrc = readFileSync(resolve(root, 'src/index.ts'), 'utf-8');
const pulseSrc = readFileSync(resolve(root, 'src/process/pulse.ts'), 'utf-8');
const correlateSrc = readFileSync(resolve(root, 'src/process/correlate.ts'), 'utf-8');

// ── SD-016 — Advisory lock prevents onDaily/catch-up race ────────────

describe('SD-016: advisory lock prevents onDaily / catch-up race', () => {
  it('source contains pg_try_advisory_lock(42424243)', () => {
    assert.ok(
      indexSrc.includes('pg_try_advisory_lock(42424243)'),
      'Expected pg_try_advisory_lock(42424243) in src/index.ts',
    );
  });

  it('source contains pg_advisory_unlock(42424243)', () => {
    assert.ok(
      indexSrc.includes('pg_advisory_unlock(42424243)'),
      'Expected pg_advisory_unlock(42424243) in src/index.ts',
    );
  });

  it('advisory lock appears in the onDaily function area', () => {
    const onDailyStart = indexSrc.indexOf('async function onDaily()');
    assert.ok(onDailyStart !== -1, 'onDaily function not found');

    // Find the next top-level async function after onDaily to bound the search
    const afterOnDaily = indexSrc.indexOf('async function onHealthCheck()', onDailyStart);
    const onDailyBody = afterOnDaily !== -1
      ? indexSrc.slice(onDailyStart, afterOnDaily)
      : indexSrc.slice(onDailyStart);

    assert.ok(
      onDailyBody.includes('pg_try_advisory_lock(42424243)'),
      'Expected pg_try_advisory_lock(42424243) within onDaily',
    );
    assert.ok(
      onDailyBody.includes('pg_advisory_unlock(42424243)'),
      'Expected pg_advisory_unlock(42424243) within onDaily',
    );
  });

  it('advisory lock appears in the onHealthCheck function area', () => {
    const onHealthCheckStart = indexSrc.indexOf('async function onHealthCheck()');
    assert.ok(onHealthCheckStart !== -1, 'onHealthCheck function not found');

    // Bound by the next section comment or end of file
    const afterHealthCheck = indexSrc.indexOf('// ── 5.', onHealthCheckStart);
    const onHealthCheckBody = afterHealthCheck !== -1
      ? indexSrc.slice(onHealthCheckStart, afterHealthCheck)
      : indexSrc.slice(onHealthCheckStart);

    assert.ok(
      onHealthCheckBody.includes('pg_try_advisory_lock(42424243)'),
      'Expected pg_try_advisory_lock(42424243) within onHealthCheck',
    );
    assert.ok(
      onHealthCheckBody.includes('pg_advisory_unlock(42424243)'),
      'Expected pg_advisory_unlock(42424243) within onHealthCheck',
    );
  });
});

// ── SD-012 — Pulse uses alias-aware entity lookup ────────────────────

describe('SD-012: pulse uses alias-aware entity lookup', () => {
  it('entity query contains LEFT JOIN entity_aliases', () => {
    assert.ok(
      pulseSrc.includes('LEFT JOIN entity_aliases'),
      'Expected LEFT JOIN entity_aliases in src/process/pulse.ts',
    );
  });

  it('WHERE clause uses ea.alias = ANY', () => {
    assert.ok(
      pulseSrc.includes('ea.alias = ANY'),
      'Expected ea.alias = ANY in src/process/pulse.ts',
    );
  });
});

// ── SD-015 — Correlation cutoff uses >= instead of > ─────────────────

describe('SD-015: correlation cutoff uses >= instead of >', () => {
  it('CORRELATION_SQL uses em.created_at >= $1', () => {
    assert.ok(
      correlateSrc.includes('em.created_at >= $1'),
      'Expected em.created_at >= $1 in src/process/correlate.ts',
    );
  });

  it('CORRELATION_SQL does NOT use em.created_at > $1 (strict greater-than)', () => {
    // Ensure there is no standalone "> $1" without the "=" — i.e. no "em.created_at > $1"
    // We check that every occurrence of "em.created_at" followed by a comparison to $1 uses >=
    const strictPattern = /em\.created_at\s+>\s+\$1(?!=)/;
    assert.ok(
      !strictPattern.test(correlateSrc),
      'Found em.created_at > $1 (without =) in src/process/correlate.ts — should be >=',
    );
  });
});
