/**
 * SM-010 — itemCount tracks actual sub-chunk size on recursive split
 *
 * Structural regression tests that verify the summarize.ts source
 * contains the ProcessedChunk type, correct return types, and proper
 * itemCount plumbing from processChunk through handleChunk.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(
  new URL('../../src/process/summarize.ts', import.meta.url),
  'utf-8',
);

describe('SM-010: ProcessedChunk itemCount plumbing', () => {
  it('defines ProcessedChunk interface or type with parsed and itemCount', () => {
    const match = src.match(
      /(?:interface|type)\s+ProcessedChunk\b[^}]*\bparsed\b.*\bitemCount\b.*}/s,
    );
    assert.ok(match, 'ProcessedChunk definition with parsed + itemCount fields must exist');
  });

  it('processChunk returns ProcessedChunk[]', () => {
    const match = src.match(
      /async\s+function\s+processChunk\b[^)]*\):\s*Promise<ProcessedChunk\[\]>/s,
    );
    assert.ok(match, 'processChunk must have return type Promise<ProcessedChunk[]>');
  });

  it('processChunk leaf return contains itemCount: chunk.length', () => {
    // Extract the processChunk function body (up to the next top-level function)
    const fnStart = src.indexOf('async function processChunk');
    assert.ok(fnStart !== -1, 'processChunk must exist');

    // Look for the leaf-level return with itemCount: chunk.length
    const fnBody = src.slice(fnStart, fnStart + 3000);
    assert.ok(
      /return\s*\[\s*\{\s*parsed\s*,\s*itemCount:\s*chunk\.length\s*\}\s*\]/.test(fnBody),
      'processChunk must return [{ parsed, itemCount: chunk.length }] at the leaf level',
    );
  });

  it('handleChunk destructures { parsed, itemCount } from processChunk results', () => {
    const handleStart = src.indexOf('async function handleChunk');
    assert.ok(handleStart !== -1, 'handleChunk must exist');

    const handleBody = src.slice(handleStart, handleStart + 3000);
    const match = handleBody.match(/for\s*\(\s*const\s*\{\s*parsed\s*,\s*itemCount\s*\}/);
    assert.ok(match, 'handleChunk must destructure { parsed, itemCount } from processChunk results');
  });

  it('summary insert uses destructured itemCount, not chunk.length', () => {
    const handleStart = src.indexOf('async function handleChunk');
    assert.ok(handleStart !== -1, 'handleChunk must exist');

    const handleBody = src.slice(handleStart, handleStart + 3000);

    // The summaryRow object should reference itemCount (the destructured variable),
    // not chunk.length
    const summaryRowMatch = handleBody.match(/summaryRow\s*=\s*\{[^}]*itemCount\b[^}]*\}/s);
    assert.ok(summaryRowMatch, 'summaryRow must contain itemCount field');

    // Verify it uses the bare variable, not chunk.length
    const rowText = summaryRowMatch![0];
    assert.ok(
      /\bitemCount\b/.test(rowText) && !/itemCount:\s*chunk\.length/.test(rowText),
      'summaryRow.itemCount must use the destructured variable, not chunk.length',
    );
  });

  it('processChunk propagates sub-results on recursive split (push spread)', () => {
    const fnStart = src.indexOf('async function processChunk');
    const fnBody = src.slice(fnStart, fnStart + 4000);

    // On recursive split, halfResults should be spread into results
    assert.ok(
      /results\.push\(\.\.\.(halfResults|subResults)\)/.test(fnBody),
      'Recursive split must spread sub-chunk ProcessedChunk[] results into the accumulator',
    );
  });
});
