/**
 * Cycle-99 structural regression tests for EM-024 ALLOWED_TABLES allowlist.
 *
 * EM-024: `embed-pipeline.ts` uses an ALLOWED_TABLES allowlist to prevent
 * SQL injection via table/column interpolation in `fetchUnembedded`.
 *
 * These are source-level pattern tests — they read the TypeScript source
 * and assert structural invariants. No runtime imports of the modules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../src/embed-pipeline.ts', import.meta.url), 'utf-8');

describe('EM-024 — ALLOWED_TABLES constant exists with summaries and reports', () => {
  it('defines ALLOWED_TABLES with summaries and reports keys', () => {
    assert.ok(src.includes('const ALLOWED_TABLES'), 'embed-pipeline.ts must define an ALLOWED_TABLES constant');
    assert.match(
      src,
      /ALLOWED_TABLES.*Record<string,\s*string\[\]>/,
      'ALLOWED_TABLES must be typed as Record<string, string[]>',
    );
    assert.ok(src.includes('summaries:') || src.includes('summaries :'), 'ALLOWED_TABLES must include a summaries key');
    assert.ok(src.includes('reports:') || src.includes('reports :'), 'ALLOWED_TABLES must include a reports key');
  });
});

describe('EM-024 — each allowed table has body in its column list', () => {
  it('summaries and reports both list body as an allowed column', () => {
    // Extract the ALLOWED_TABLES block
    const start = src.indexOf('const ALLOWED_TABLES');
    const block = src.slice(start, src.indexOf('};', start) + 2);

    const summariesMatch = block.match(/summaries:\s*\[([^\]]*)\]/);
    assert.ok(summariesMatch, 'summaries key must have an array value');
    assert.ok(summariesMatch![1].includes("'body'"), "summaries column list must include 'body'");

    const reportsMatch = block.match(/reports:\s*\[([^\]]*)\]/);
    assert.ok(reportsMatch, 'reports key must have an array value');
    assert.ok(reportsMatch![1].includes("'body'"), "reports column list must include 'body'");
  });
});

describe('EM-024 — fetchUnembedded validates table/column before query', () => {
  it('throws on invalid table or column combination', () => {
    const fnStart = src.indexOf('async function fetchUnembedded');
    assert.ok(fnStart > -1, 'embed-pipeline.ts must define fetchUnembedded');
    const fnBody = src.slice(fnStart);

    assert.ok(fnBody.includes('ALLOWED_TABLES[tableName]'), 'fetchUnembedded must look up tableName in ALLOWED_TABLES');
    assert.ok(
      fnBody.includes('.includes(textColumn)'),
      'fetchUnembedded must check textColumn against allowed columns',
    );
    assert.ok(fnBody.includes('throw new Error'), 'fetchUnembedded must throw on invalid table/column');
  });
});

describe('EM-024 — error message includes table and column names for debugging', () => {
  it('interpolates tableName and textColumn into the error message', () => {
    const fnStart = src.indexOf('async function fetchUnembedded');
    const fnBody = src.slice(fnStart);

    // Find the throw statement
    const throwIdx = fnBody.indexOf('throw new Error');
    assert.ok(throwIdx > -1, 'must have a throw statement');

    const throwLine = fnBody.slice(throwIdx, fnBody.indexOf('\n', throwIdx));
    assert.ok(
      throwLine.includes('tableName') && throwLine.includes('textColumn'),
      'error message must interpolate both tableName and textColumn for debugging',
    );
  });
});
