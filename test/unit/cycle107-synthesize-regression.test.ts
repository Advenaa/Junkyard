/**
 * Structural regression tests for cycle 107 synthesize fixes:
 *
 * SY-006: Quiet-day report generation (rows.length === 0 still produces a report)
 * SY-001: Narratives consumed by daily synthesis
 * SY-003: Stale momentum data warning
 * SM-008: Entity name-to-ID matching with alias fallback
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

const src = readSrc('src/process/synthesize.ts') + '\n' + readSrc('src/process/synthesis-context.ts');

// ===========================================================================
// SY-006: Quiet-day report generation
// ===========================================================================

describe('SY-006: quiet-day report generation', () => {
  it('sets quietDay variable when rows.length === 0', () => {
    assert.ok(src.includes('const quietDay = rows.length === 0'), 'must set quietDay when rows.length === 0');
  });

  it('passes quietDay as the last parameter to buildDailyUserMessage', () => {
    assert.match(
      src,
      /buildDailyUserMessage\([\s\S]*?,\s*quietDay,?\s*\)/,
      'buildDailyUserMessage call must end with quietDay parameter',
    );
  });

  it('includes <quiet_day> XML tag in buildDailyUserMessage when quietDay is true', () => {
    assert.match(src, /<quiet_day>/, 'buildDailyUserMessage must emit a <quiet_day> XML tag for quiet days');
  });

  it('skips correlator on quiet days', () => {
    assert.match(
      src,
      /quietDay[\s\S]*?correlated:\s*\[\]\s*as\s*CorrelatedEntity\[\]/,
      'correlator.run must be skipped when quietDay is true',
    );
  });

  it('buildDailyUserMessage signature includes quietDay with default false', () => {
    assert.match(
      src,
      /quietDay\s*:\s*boolean\s*=\s*false/,
      'quietDay parameter must default to false in buildDailyUserMessage',
    );
  });
});

// ===========================================================================
// SY-001: Narratives consumed by daily synthesis
// ===========================================================================

describe('SY-001: narratives consumed by synthesis', () => {
  it('queries narratives table with created_at > $1 and ORDER BY member_count DESC', () => {
    assert.match(
      src,
      /FROM\s+narratives\s+WHERE\s+created_at\s*>\s*\$1\s+ORDER\s+BY\s+member_count\s+DESC/i,
      'must query narratives with created_at > $1 ORDER BY member_count DESC',
    );
  });

  it('includes <narrative_context> XML block in buildDailyUserMessage', () => {
    assert.match(src, /<narrative_context>/, 'buildDailyUserMessage must include a <narrative_context> XML block');
  });

  it('defines the NarrativeContext interface', () => {
    assert.match(src, /interface\s+NarrativeContext\s*\{/, 'NarrativeContext interface must be defined');
  });

  it('passes narratives to buildDailyUserMessage', () => {
    assert.match(
      src,
      /buildDailyUserMessage\([^)]*narratives[^)]*\)/,
      'narratives must be passed to buildDailyUserMessage',
    );
  });

  it('buildDailyUserMessage accepts narratives parameter typed as NarrativeContext[]', () => {
    assert.match(
      src,
      /narratives\s*:\s*NarrativeContext\[\]/,
      'buildDailyUserMessage must accept narratives: NarrativeContext[]',
    );
  });
});

// ===========================================================================
// SY-003: Stale momentum data warning
// ===========================================================================

describe('SY-003: stale momentum data warning', () => {
  it('has SY-003 comment in the source', () => {
    assert.ok(src.includes('SY-003'), 'SY-003 comment must exist in the source');
  });

  it('compares latestDate with todayStr using toLocaleDateString(en-CA)', () => {
    assert.match(
      src,
      /toLocaleDateString\(\s*'en-CA'\s*\)/,
      'must use toLocaleDateString("en-CA") for date comparison',
    );
    assert.match(src, /latestDate\s*!==\s*todayStr/, 'must compare latestDate !== todayStr to detect staleness');
  });

  it('stale note includes "momentum data is from" and "rollup may have failed"', () => {
    assert.ok(src.includes('momentum data is from'), 'stale note must mention "momentum data is from"');
    assert.ok(src.includes('rollup may have failed'), 'stale note must mention "rollup may have failed"');
  });
});

// ===========================================================================
// SM-008: Entity name-to-ID matching with alias fallback
// ===========================================================================

describe('SM-008: entity name-to-ID matching with alias fallback', () => {
  it('has SM-008 comment in the source', () => {
    assert.ok(src.includes('SM-008'), 'SM-008 comment must exist in the source');
  });

  it('entity ID query uses LEFT JOIN entity_aliases ea ON ea.entity_id = e.id', () => {
    assert.match(
      src,
      /LEFT\s+JOIN\s+entity_aliases\s+ea\s+ON\s+ea\.entity_id\s*=\s*e\.id/i,
      'must use LEFT JOIN entity_aliases ea ON ea.entity_id = e.id',
    );
  });

  it('query matches both name and alias with WHERE e.name = ANY($1) OR ea.alias = ANY($2)', () => {
    assert.match(
      src,
      /WHERE\s+e\.name\s*=\s*ANY\(\$1\)\s+OR\s+ea\.alias\s*=\s*ANY\(\$2\)/i,
      'must match both e.name = ANY($1) and ea.alias = ANY($2)',
    );
  });

  it('computes normalizedNames from entityNames.map', () => {
    assert.match(src, /normalizedNames\s*=\s*entityNames\.map\(/, 'must compute normalizedNames via entityNames.map()');
  });
});
