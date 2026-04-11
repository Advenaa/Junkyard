/**
 * Cycle-99 structural regression tests for EM-023 fix in embed.ts.
 *
 * EM-023 follow-up: Batch result length mismatch must hard-fail to avoid
 *                   silently misaligning embeddings with their targets.
 *
 * These are source-level pattern tests — they read the TypeScript source
 * and assert structural invariants. No runtime imports of the modules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const embedSrc = readFileSync(new URL('../../src/embed.ts', import.meta.url), 'utf-8');

// Extract the embedBatch function body for scoped assertions
const embedBatchIdx = embedSrc.indexOf('async function embedBatch(');
assert.ok(embedBatchIdx > -1, 'precondition: should find embedBatch function');

// Find the closing of the function (next function or end of createEmbedder)
const embedBatchEnd = embedSrc.indexOf('\n  async function ', embedBatchIdx + 1);
const embedBatchBody = embedSrc.slice(embedBatchIdx, embedBatchEnd > -1 ? embedBatchEnd : undefined);

describe('EM-023 — embedBatch batch result length mismatch handling', () => {
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

  it('throws instead of padding nulls after a mismatch', () => {
    assert.ok(
      embedBatchBody.includes('throw new Error') &&
        embedBatchBody.includes('expected ${chunk.length} embeddings but got ${batchResult.embeddings.length}'),
      'embedBatch must throw a hard error when the API returns fewer embeddings than requested',
    );

    assert.doesNotMatch(
      embedBatchBody,
      /results\.push\(null\)/,
      'embedBatch must not pad missing embedding entries with null after a mismatch',
    );
  });

  it('still iterates successful batches over chunk.length', () => {
    assert.match(
      embedBatchBody,
      /for\s*\(\s*let\s+\w+\s*=\s*0;\s*\w+\s*<\s*chunk\.length/,
      'embedBatch inner loop must still iterate using chunk.length as the upper bound',
    );

    assert.ok(
      !/for\s*\([^)]*<\s*batchResult\.embeddings\.length/.test(embedBatchBody),
      'embedBatch inner loop must NOT use batchResult.embeddings.length as loop bound',
    );
  });

  it('return type still allows null entries when embeddings are unavailable', () => {
    // The function signature or explicit type must include (EmbedResult | null)[]
    assert.match(
      embedSrc,
      /embedBatch\(.*\):\s*Promise<\(EmbedResult\s*\|\s*null\)\[\]>/,
      'embedBatch return type must be Promise<(EmbedResult | null)[]>',
    );
  });
});
