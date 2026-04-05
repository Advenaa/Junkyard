/**
 * Cycle 121 — structural regression tests for correlate, schemas, and pulse fixes.
 *
 * These tests read source files and assert code patterns that must hold
 * to prevent regressions on CO-011, CO-013, SY-009, and PL-004.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');

const correlate = readFileSync(resolve(root, 'src/process/correlate.ts'), 'utf-8');
const schemas = readFileSync(resolve(root, 'src/process/schemas.ts'), 'utf-8');
const pulse = readFileSync(resolve(root, 'src/process/pulse.ts'), 'utf-8');

// ── CO-011: Trust weight iterates uniqueSourceIds and picks highest ──

describe('CO-011 — trust weight iterates uniqueSourceIds for best weight', () => {
  it('uniqueSourceIds variable exists in the per-entity loop', () => {
    assert.ok(
      /for\s*\(.*seenSources\)[\s\S]*?const\s+uniqueSourceIds\s*=/m.test(correlate),
      'Expected uniqueSourceIds to be declared inside the seenSources iteration loop',
    );
  });

  it('bestTrustWeight variable exists in the per-entity loop', () => {
    assert.ok(
      /for\s*\(.*seenSources\)[\s\S]*?let\s+bestTrustWeight\s*=/m.test(correlate),
      'Expected bestTrustWeight to be declared inside the seenSources iteration loop',
    );
  });
});

// ── CO-013: json_agg has ORDER BY em.created_at ─────────────────────

describe('CO-013 — CORRELATION_SQL json_agg has ORDER BY', () => {
  it('json_agg contains ORDER BY em.created_at', () => {
    // Extract the CORRELATION_SQL block
    const sqlMatch = correlate.match(/CORRELATION_SQL\s*=\s*`([\s\S]*?)`;/);
    assert.ok(sqlMatch, 'Expected CORRELATION_SQL template literal to exist');
    const sql = sqlMatch[1];
    assert.ok(
      /json_agg\([\s\S]*?ORDER BY\s+em\.created_at/i.test(sql),
      'Expected json_agg to contain ORDER BY em.created_at',
    );
  });
});

// ── SY-009: Entity sentiment name, sections title, newProjects name have .min(1) ──

describe('SY-009 — schema string fields have .min(1) validation', () => {
  it('entitySentiment name field has .min(1)', () => {
    // The entitySentiment block should contain name: z.string().min(1)
    assert.ok(
      /entitySentiment[\s\S]*?name:\s*z\.string\(\)\.min\(1\)/.test(schemas),
      'Expected entitySentiment name to have .min(1)',
    );
  });

  it('sections title field has .min(1)', () => {
    assert.ok(
      /sections[\s\S]*?title:\s*z\.string\(\)\.min\(1\)/.test(schemas),
      'Expected sections title to have .min(1)',
    );
  });

  it('newProjects name field has .min(1)', () => {
    assert.ok(
      /newProjects[\s\S]*?name:\s*z\.string\(\)\.min\(1\)/.test(schemas),
      'Expected newProjects name to have .min(1)',
    );
  });
});

// ── PL-004: Quiet pulse maxTokens is 500 not 300 ───────────────────

describe('PL-004 — quiet pulse maxTokens is 500', () => {
  it('computeMaxTokens returns 500 as the default/minimum', () => {
    // The function should have "return 500" as the fallback (quiet) case
    const fnMatch = pulse.match(/function\s+computeMaxTokens[\s\S]*?return\s+500\s*;/);
    assert.ok(fnMatch, 'Expected computeMaxTokens to contain "return 500" as the quiet-period default');
  });
});
