/**
 * Cycle 113 — Structural regression tests for vector-cache, synthesize, summarize
 *
 * VE-010: cosineSimilarity dimension guard
 * SD-013: Divergence uses trailing 24h window
 * IP-015: Entity resolution failure keeps summary
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
// IP-015 — Entity resolution failure keeps summary
// ---------------------------------------------------------------------------
describe('IP-015 — Entity resolution failure keeps summary', () => {
  /** Extract the entity resolution try/catch block from summarize.ts. */
  function extractEntityResolutionBlock(): string {
    // Find the actual resolveEntities call (not the interface definition)
    // The call site uses entityManager.resolveEntities(
    const resolveIdx = summarizeSrc.indexOf('entityManager.resolveEntities(');
    assert.notEqual(resolveIdx, -1, 'Could not locate entityManager.resolveEntities() call in summarize.ts');

    // Walk backwards to find the enclosing try
    const beforeResolve = summarizeSrc.slice(0, resolveIdx);
    const tryIdx = beforeResolve.lastIndexOf('try');
    assert.notEqual(tryIdx, -1, 'Could not locate try block before resolveEntities');

    // Walk forward from resolveEntities to find the OUTER catch block
    // (skip inner try/catch pairs like the alpha tracker wrapper)
    const afterResolve = summarizeSrc.slice(resolveIdx);
    let catchSearchPos = 0;
    let outerCatchIdx = -1;
    let tryDepth = 0;
    while (catchSearchPos < afterResolve.length) {
      const nextTry = afterResolve.indexOf('try', catchSearchPos);
      const nextCatch = afterResolve.indexOf('catch', catchSearchPos);
      if (nextCatch === -1) break;
      if (nextTry !== -1 && nextTry < nextCatch) {
        tryDepth++;
        catchSearchPos = nextTry + 3;
      } else if (tryDepth > 0) {
        tryDepth--;
        catchSearchPos = nextCatch + 5;
      } else {
        outerCatchIdx = nextCatch;
        break;
      }
    }
    assert.notEqual(outerCatchIdx, -1, 'Could not locate catch block after resolveEntities');

    // Extract from try to the end of the catch block
    const catchStart = resolveIdx + outerCatchIdx;
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

    return summarizeSrc.slice(tryIdx, catchEnd);
  }

  const block = extractEntityResolutionBlock();

  it('resolveEntities is wrapped in a try/catch', () => {
    assert.match(block, /try\s*\{/, 'resolveEntities must be wrapped in a try block');
    assert.ok(block.includes('catch'), 'resolveEntities must have a catch block');
  });

  it('catch block logs a warning (not error)', () => {
    // The catch block should use log.warn, not log.error
    const catchSection = block.slice(block.indexOf('catch'));
    assert.ok(catchSection.includes('log.warn'), 'Entity resolution catch block must log a warning via log.warn');
  });

  it('catch block does NOT delete the summary', () => {
    const catchSection = block.slice(block.indexOf('catch'));
    assert.ok(!catchSection.includes('deleteSummary'), 'Entity resolution catch block must NOT call deleteSummary');
  });

  it('catch block does NOT re-throw the error', () => {
    const catchSection = block.slice(block.indexOf('catch'));
    // Check there's no throw statement in the catch block
    assert.ok(!catchSection.match(/\bthrow\b/), 'Entity resolution catch block must NOT re-throw the error');
  });

  it('log message mentions keeping the summary', () => {
    const catchSection = block.slice(block.indexOf('catch'));
    assert.ok(catchSection.includes('keeping summary'), 'Entity resolution warning must mention keeping the summary');
  });
});
