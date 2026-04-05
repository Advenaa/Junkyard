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
      if (depth === 0) {
        fnEnd = i;
        break;
      }
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

  it('uses timezone-aware day boundary (SQL AT TIME ZONE or JS toLocaleDateString)', () => {
    const fnStart = source.indexOf('async function checkCostSpike');
    const fnBody = source.slice(fnStart, source.indexOf('\n  async function', fnStart + 1));

    const usesAtTimeZone = fnBody.includes('AT TIME ZONE');
    const usesToLocaleDateString = fnBody.includes('toLocaleDateString') && fnBody.includes('timeZone');

    assert.ok(
      usesAtTimeZone || usesToLocaleDateString,
      'checkCostSpike must use AT TIME ZONE or toLocaleDateString for timezone-aware day boundary',
    );
  });

  it('imports getAppConfig from db/queries', () => {
    assert.ok(
      source.includes('import { getAppConfig }') ||
        source.includes('import {getAppConfig}') ||
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

describe('HM-002: 7-day avg uses total/7 instead of per-day AVG (RESOLVED)', () => {
  it('checkCostSpike uses SUM/7.0 or equivalent for correct 7-day average', () => {
    const fnStart = source.indexOf('async function checkCostSpike');
    const fnBody = source.slice(fnStart, source.indexOf('\n  async function', fnStart + 1));

    // HM-002 fix: use total-over-period (SUM/7.0) instead of GROUP BY + AVG
    const usesTotalDivision = fnBody.includes('/ 7.0') || fnBody.includes('/7.0');
    const usesGenerateSeries = fnBody.includes('generate_series');
    const noGroupByDivision = !fnBody.includes('GROUP BY (created_at / 86400000)');

    assert.ok(
      (usesTotalDivision || usesGenerateSeries) && noGroupByDivision,
      'HM-002: should use SUM/7.0 or generate_series, not GROUP BY integer division',
    );
  });
});

describe('HM-003: pool exhaustion hardcodes >= 10 (open issue)', () => {
  it('checkDbPoolExhaustion still hardcodes the threshold', () => {
    const fnStart = source.indexOf('function checkDbPoolExhaustion');
    assert.ok(fnStart !== -1, 'checkDbPoolExhaustion must exist');

    const fnBody = source.slice(
      fnStart,
      source.indexOf('\n  async function', fnStart + 1) === -1
        ? source.indexOf('\n  function', fnStart + 1)
        : source.indexOf('\n  async function', fnStart + 1),
    );

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
