/**
 * Structural regression tests for health monitor fixes (HM-001 through HM-004).
 *
 * These tests read the source text of src/health.ts and assert code patterns,
 * ensuring fixes stay in place and known-open issues are tracked.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HEALTH_SRC = resolve(__dirname, '../../src/health.ts');

let source: string;

before(async () => {
  source = await readFile(HEALTH_SRC, 'utf-8');
});

describe('HM-001: cost spike timezone fix', () => {
  it('checkCostSpike calls getAppConfig for timezone', () => {
    // Extract the checkCostSpike function body
    const fnStart = source.indexOf('async function checkCostSpike');
    assert.ok(fnStart !== -1, 'checkCostSpike function must exist');

    // Find the matching closing brace (simple depth counting)
    const afterStart = source.indexOf('{', fnStart);
    let depth = 0;
    let fnEnd = -1;
    for (let i = afterStart; i < source.length; i++) {
      if (source[i] === '{') depth++;
      if (source[i] === '}') depth--;
      if (depth === 0) { fnEnd = i; break; }
    }
    assert.ok(fnEnd > fnStart, 'Could not find end of checkCostSpike');
    const fnBody = source.slice(fnStart, fnEnd + 1);

    assert.ok(
      fnBody.includes("getAppConfig(pool, 'timezone')") ||
      fnBody.includes('getAppConfig(pool, "timezone")') ||
      fnBody.includes('getAppConfig(pool, `timezone`)'),
      'checkCostSpike must read timezone from getAppConfig',
    );
  });

  it('does NOT use the old UTC modulo day-boundary pattern', () => {
    const fnStart = source.indexOf('async function checkCostSpike');
    const fnBody = source.slice(fnStart, source.indexOf('\n  async function', fnStart + 1));

    // The old buggy pattern: now % (24 * 60 * 60 * 1000)
    assert.ok(
      !fnBody.includes('% (24 * 60 * 60 * 1000)'),
      'checkCostSpike must not use `now % (24 * 60 * 60 * 1000)` UTC modulo pattern',
    );
    // Also check for the numeric literal form
    assert.ok(
      !fnBody.includes('% 86400000'),
      'checkCostSpike must not use `% 86400000` UTC modulo pattern for day boundary',
    );
  });

  it('uses timezone-aware API (toLocaleDateString with timeZone option)', () => {
    const fnStart = source.indexOf('async function checkCostSpike');
    const fnBody = source.slice(fnStart, source.indexOf('\n  async function', fnStart + 1));

    assert.ok(
      fnBody.includes('toLocaleDateString') && fnBody.includes('timeZone'),
      'checkCostSpike must use toLocaleDateString with timeZone for timezone-aware day boundary',
    );
  });

  it('imports getAppConfig from db/queries', () => {
    assert.ok(
      source.includes("import { getAppConfig }") ||
      source.includes("import {getAppConfig}") ||
      // might be a named import among others
      /import\s*\{[^}]*getAppConfig[^}]*\}/.test(source),
      'health.ts must import getAppConfig',
    );
    assert.ok(
      source.includes("from './db/queries") || source.includes('from "./db/queries'),
      'getAppConfig must be imported from db/queries',
    );
  });
});

describe('HM-002: 7-day avg query excludes zero-activity days (open issue)', () => {
  it('avg_cost subquery still uses GROUP BY integer division (zero-activity days excluded from AVG)', () => {
    // The current query groups by (created_at / 86400000) which is integer
    // division in epoch-ms. Days with zero activity simply have no rows, so
    // they are absent from the GROUP BY and thus excluded from AVG.
    // This inflates the average and could mask a real spike.
    //
    // This test documents the open issue: when this is fixed, the query
    // should produce explicit zero-cost rows for inactive days within the window.
    const fnStart = source.indexOf('async function checkCostSpike');
    const fnBody = source.slice(fnStart, source.indexOf('\n  async function', fnStart + 1));

    const usesIntegerDivisionGrouping = fnBody.includes('GROUP BY (created_at / 86400000)');
    // If someone fixes HM-002, they would use generate_series or a date-based approach
    const usesGenerateSeries = fnBody.includes('generate_series');
    const usesDateTrunc = fnBody.includes('date_trunc');

    if (usesIntegerDivisionGrouping && !usesGenerateSeries && !usesDateTrunc) {
      // Issue is still open — document it
      assert.ok(
        true,
        'HM-002 is still open: zero-activity days are excluded from 7-day avg, inflating the average',
      );
    } else {
      // Someone appears to have fixed it — this test should be updated
      assert.ok(
        usesGenerateSeries || usesDateTrunc,
        'HM-002 appears partially fixed but does not use generate_series or date_trunc',
      );
    }
  });
});

describe('HM-003: pool exhaustion hardcodes >= 10 (open issue)', () => {
  it('checkDbPoolExhaustion still hardcodes the threshold', () => {
    const fnStart = source.indexOf('function checkDbPoolExhaustion');
    assert.ok(fnStart !== -1, 'checkDbPoolExhaustion must exist');

    const fnBody = source.slice(fnStart, source.indexOf('\n  async function', fnStart + 1) === -1
      ? source.indexOf('\n  function', fnStart + 1)
      : source.indexOf('\n  async function', fnStart + 1));

    const hardcoded = fnBody.includes('>= 10') || fnBody.includes('>=10');

    if (hardcoded) {
      // Issue is still open — the threshold should come from config or pool.options.max
      assert.ok(
        true,
        'HM-003 is still open: pool exhaustion uses hardcoded >= 10 instead of pool.options.max or config',
      );
    } else {
      // Someone fixed it — verify it reads from config or pool
      assert.ok(
        fnBody.includes('pool.options') || fnBody.includes('config.'),
        'HM-003 appears fixed but threshold does not come from pool.options or config',
      );
    }
  });
});
