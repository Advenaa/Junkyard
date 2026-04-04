/**
 * Cycle 118 — structural regression tests for pipeline fixes.
 *
 * These tests read source files and assert code patterns that must hold
 * to prevent regressions on PS-001, EP-001, and SM-001.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');

const preSummarize = readFileSync(resolve(root, 'src/pre-summarize/index.ts'), 'utf-8');
const embedPipeline = readFileSync(resolve(root, 'src/embed-pipeline.ts'), 'utf-8');
const summarize = readFileSync(resolve(root, 'src/process/summarize.ts'), 'utf-8');

// ── PS-001: Pre-summarize success UPDATE resets retry_count ──────────

describe('PS-001 — pre-summarize success UPDATE resets retry_count', () => {
  it('success UPDATE that sets status=ready also sets retry_count = 0', () => {
    // Find the UPDATE query that sets status = 'ready' for successful items
    const successUpdate = preSummarize.match(
      /UPDATE items SET.*status\s*=\s*'ready'.*retry_count\s*=\s*0/s,
    );
    assert.ok(
      successUpdate,
      "Expected success UPDATE to contain both status = 'ready' and retry_count = 0",
    );
  });

  it('retry_count = 0 appears in the same query as content = data.content (success path)', () => {
    // The success UPDATE replaces content AND resets retry_count
    const updateWithContent = preSummarize.match(
      /UPDATE items SET\s+content\s*=\s*data\.content.*retry_count\s*=\s*0/s,
    );
    assert.ok(
      updateWithContent,
      'Expected the content-replacement UPDATE to also reset retry_count to 0',
    );
  });
});

// ── EP-001: Embed pipeline fetches oldest first ─────────────────────

describe('EP-001 — embed pipeline fetches oldest first (ASC)', () => {
  it('fetchUnembedded ORDER BY uses ASC', () => {
    const orderClause = embedPipeline.match(/ORDER BY\s+t\.created_at\s+(ASC|DESC)/i);
    assert.ok(orderClause, 'Expected an ORDER BY t.created_at clause in fetchUnembedded');
    assert.equal(
      orderClause[1].toUpperCase(),
      'ASC',
      'fetchUnembedded must order by created_at ASC to process oldest first',
    );
  });
});

// ── SM-001: Oversized item truncation before failure ────────────────

describe('SM-001 — oversized single item is truncated before marking failed', () => {
  it('truncation (.slice) occurs in the single-item-exceeds-context block', () => {
    // The block starts at chunk.length <= 1 inside the ContextLengthExceededError handler.
    // We look for .slice( between the chunk.length <= 1 guard and the status = 'failed' UPDATE.
    const singleItemBlock = summarize.match(
      /chunk\.length\s*<=\s*1[\s\S]*?\.slice\([\s\S]*?status\s*=\s*'failed'/,
    );
    assert.ok(
      singleItemBlock,
      "Expected .slice() truncation to appear between the single-item guard and the status = 'failed' UPDATE",
    );
  });

  it('defines a TRUNCATION_CHAR_LIMIT constant', () => {
    assert.ok(
      /const\s+TRUNCATION_CHAR_LIMIT\s*=\s*\d+/.test(summarize),
      'Expected a TRUNCATION_CHAR_LIMIT constant in summarize.ts',
    );
  });
});
