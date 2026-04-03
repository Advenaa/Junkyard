/**
 * Cycle-99 structural regression tests for EM-023 fix in embed.ts.
 *
 * EM-023: Batch result length mismatch handled — embedBatch inner loop
 *         iterates over chunk.length (not batchResult.embeddings.length),
 *         warns on mismatch, and pads missing entries with null.
 *
 * These are source-level pattern tests — they read the TypeScript source
 * and assert structural invariants. No runtime imports of the modules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const embedSrc = readFileSync(
  new URL('../../src/embed.ts', import.meta.url), 'utf-8',
);

// Extract the embedBatch function body for scoped assertions
const embedBatchIdx = embedSrc.indexOf('async function embedBatch(');
assert.ok(embedBatchIdx > -1, 'precondition: should find embedBatch function');

// Find the closing of the function (next function or end of createEmbedder)
const embedBatchEnd = embedSrc.indexOf('\n  async function ', embedBatchIdx + 1);
const embedBatchBody = embedSrc.slice(
  embedBatchIdx,
  embedBatchEnd > -1 ? embedBatchEnd : undefined,
);

describe('EM-023 — embedBatch batch result length mismatch handling', () => {
  it('inner loop iterates over chunk.length, not batchResult.embeddings.length', () => {
    // The for-loop must use chunk.length as the bound
    assert.match(
      embedBatchBody,
      /for\s*\(\s*let\s+\w+\s*=\s*0;\s*\w+\s*<\s*chunk\.length/,
      'embedBatch inner loop must iterate using chunk.length as the upper bound',
    );

    // Must NOT iterate over batchResult.embeddings.length as the loop bound
    assert.ok(
      !/for\s*\([^)]*<\s*batchResult\.embeddings\.length/.test(embedBatchBody),
      'embedBatch inner loop must NOT use batchResult.embeddings.length as loop bound',
    );
  });

  it('checks for length mismatch between batchResult.embeddings and chunk', () => {
    assert.match(
      embedBatchBody,
      /batchResult\.embeddings\.length\s*!==\s*chunk\.length/,
      'embedBatch must compare batchResult.embeddings.length !== chunk.length',
    );

    // The mismatch check should trigger a warning log
    assert.ok(
      embedBatchBody.includes('batch result count mismatch'),
      'embedBatch must log a warning message about batch result count mismatch',
    );
  });

  it('pads missing entries with null via an else branch', () => {
    // There must be a conditional guard checking j < batchResult.embeddings.length
    assert.match(
      embedBatchBody,
      /if\s*\(\s*\w+\s*<\s*batchResult\.embeddings\.length\s*\)/,
      'embedBatch must guard access with j < batchResult.embeddings.length',
    );

    // The else branch must push null for missing embeddings
    assert.ok(
      embedBatchBody.includes('results.push(null)'),
      'embedBatch else branch must push null for missing embedding entries',
    );
  });

  it('return type allows null entries (EmbedResult | null)', () => {
    // The function signature or explicit type must include (EmbedResult | null)[]
    assert.match(
      embedSrc,
      /embedBatch\(.*\):\s*Promise<\(EmbedResult\s*\|\s*null\)\[\]>/,
      'embedBatch return type must be Promise<(EmbedResult | null)[]>',
    );
  });
});
