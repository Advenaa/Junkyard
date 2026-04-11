/**
 * Cycle 113 — Structural regression tests for vector-cache, synthesize, summarize
 *
 * VE-010: cosineSimilarity dimension guard
 * SD-013: Divergence uses trailing 24h window
 * IP-015: Entity resolution failure rolls back summary
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const vectorCacheSrc = readFileSync(path.join(root, 'src', 'vector-cache.ts'), 'utf-8');
const synthesizeSrc = readFileSync(path.join(root, 'src', 'process', 'synthesize.ts'), 'utf-8');
const summarizeSrc = readFileSync(path.join(root, 'src', 'process', 'summarize.ts'), 'utf-8');

// ---------------------------------------------------------------------------
// VE-010 — cosineSimilarity dimension guard
// ---------------------------------------------------------------------------
describe('VE-010 — cosineSimilarity dimension guard', () => {
  /** Extract the cosineSimilarity function body. */
  function extractCosineSimilarity(): string {
    const fnStart = vectorCacheSrc.indexOf('export function cosineSimilarity');
    assert.notEqual(fnStart, -1, 'Could not locate cosineSimilarity in vector-cache.ts');
    // Find the closing brace of the function (next export or end)
    const nextExport = vectorCacheSrc.indexOf('\nexport ', fnStart + 1);
    const nextFunction = vectorCacheSrc.indexOf('\nfunction ', fnStart + 1);
    const end = Math.min(nextExport === -1 ? Infinity : nextExport, nextFunction === -1 ? Infinity : nextFunction);
    return vectorCacheSrc.slice(fnStart, end === Infinity ? undefined : end);
  }

  const fn = extractCosineSimilarity();

  it('contains a.length !== b.length dimension check', () => {
    assert.ok(
      fn.includes('a.length !== b.length'),
      'cosineSimilarity must guard against mismatched dimensions with a.length !== b.length',
    );
  });

  it('returns 0 when dimensions do not match', () => {
    // The guard line should return 0 on mismatch
    assert.match(
      fn,
      /if\s*\(\s*a\.length\s*!==\s*b\.length\s*\)\s*return\s+0/,
      'cosineSimilarity must return 0 when dimensions differ',
    );
  });
});

// ---------------------------------------------------------------------------
// SD-013 — Divergence uses trailing 24h window
// ---------------------------------------------------------------------------
describe('SD-013 — Divergence uses trailing 24h window', () => {
  /** Extract the runDaily function body from synthesize.ts. */
  function extractRunDaily(): string {
    const fnStart = synthesizeSrc.indexOf('async function runDaily()');
    assert.notEqual(fnStart, -1, 'Could not locate runDaily in synthesize.ts');
    // Find the next top-level async function
    const nextFn = synthesizeSrc.indexOf('\n  async function ', fnStart + 1);
    return synthesizeSrc.slice(fnStart, nextFn === -1 ? undefined : nextFn);
  }

  const runDaily = extractRunDaily();

  it('divergence calculation uses trailing 24h (Date.now() - 24 * 60 * 60 * 1000)', () => {
    assert.match(
      runDaily,
      /24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/,
      'Divergence window must use 24 * 60 * 60 * 1000 trailing calculation',
    );
  });

  it('getDivergence receives the trailing window, not calendar-day start/end', () => {
    // Extract just the getDivergence call and its surrounding context
    const divCallIdx = runDaily.indexOf('getDivergence(');
    assert.notEqual(divCallIdx, -1, 'Could not locate getDivergence call in runDaily');
    const callContext = runDaily.slice(Math.max(0, divCallIdx - 200), divCallIdx + 100);

    // The call should use divergenceStart/divergenceEnd, NOT the calendar-day start/end
    assert.ok(
      callContext.includes('divergenceStart') && callContext.includes('divergenceEnd'),
      'getDivergence must be called with divergenceStart/divergenceEnd (trailing 24h vars)',
    );

    // It must NOT pass the calendar-day variables (start, end from getTodayWindow)
    // The actual call should NOT have (start, end) — those are the calendar-day bounds
    const callLine = runDaily.slice(divCallIdx, runDaily.indexOf('\n', divCallIdx));
    assert.ok(
      !callLine.match(/getDivergence\(\s*start\s*,\s*end\b/),
      'getDivergence must NOT be called with calendar-day start, end variables',
    );
  });
});

// ---------------------------------------------------------------------------
// IP-015 — Entity resolution failure rolls back summary
// ---------------------------------------------------------------------------
describe('IP-015 — Entity resolution failure rolls back summary', () => {
  function extractSummaryTransactionCatch(): string {
    const catchStart = summarizeSrc.indexOf('} catch (summaryErr: unknown) {');
    assert.notEqual(catchStart, -1, 'Could not locate summary transaction catch block');

    const catchBody = summarizeSrc.slice(catchStart);
    const braceOpen = catchBody.indexOf('{');
    let depth = 0;
    let catchEnd = catchStart;
    for (let i = braceOpen; i < catchBody.length; i++) {
      if (catchBody[i] === '{') depth++;
      if (catchBody[i] === '}') depth--;
      if (depth === 0) {
        catchEnd = catchStart + i + 1;
        break;
      }
    }

    return summarizeSrc.slice(catchStart, catchEnd);
  }

  const catchBlock = extractSummaryTransactionCatch();

  it('starts a transaction before inserting the summary', () => {
    assert.ok(summarizeSrc.includes("await client.query('BEGIN')"), 'Summary path must begin a transaction');
    assert.ok(
      summarizeSrc.includes('await insertSummary(client, summaryRow)'),
      'Summary insert must use the tx client',
    );
  });

  it('passes the shared client into resolveEntities', () => {
    assert.match(
      summarizeSrc,
      /entityManager\.resolveEntities\([\s\S]*predominantLang,\s*client,\s*\)/,
      'resolveEntities must run on the same client as insertSummary',
    );
  });

  it('commits only after entity resolution completes', () => {
    const resolveIdx = summarizeSrc.indexOf('entityManager.resolveEntities(');
    const commitIdx = summarizeSrc.indexOf("await client.query('COMMIT')");
    assert.ok(
      resolveIdx !== -1 && commitIdx !== -1 && commitIdx > resolveIdx,
      'COMMIT must happen after resolveEntities',
    );
  });

  it('catch block rolls back and re-throws', () => {
    assert.ok(
      catchBlock.includes("await client.query('ROLLBACK').catch(() => {});"),
      'Summary transaction catch block must roll back',
    );
    assert.match(catchBlock, /\bthrow\s+summaryErr\b/, 'Summary transaction catch block must re-throw the error');
  });

  it('does not keep the old keep-summary warning path', () => {
    assert.ok(
      !summarizeSrc.includes('keeping summary without entities'),
      'Entity resolution failure should no longer keep orphaned summaries',
    );
  });
});
