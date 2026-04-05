/**
 * Cycle-102 structural regression tests.
 *
 * CQ-002: Tool result truncation in chat handler
 * CQ-010: ALLOWED_TABLES allowlist in chat tools
 * LC-001: vectorCache.load() before startServer()
 * LC-005: shuttingDown guard in refreshDailyCron
 * IP-001: Pre-summarize sets batch_id
 * IP-004: LLM error increments retry_count
 *
 * Source-level pattern tests — read TypeScript source and assert structural
 * invariants. No runtime imports of the modules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chatHandler = readFileSync(new URL('../../src/chat/handler.ts', import.meta.url), 'utf-8');

const chatTools = readFileSync(new URL('../../src/chat/tools.ts', import.meta.url), 'utf-8');

const indexSrc = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf-8');

const schedulerSrc = readFileSync(new URL('../../src/scheduler.ts', import.meta.url), 'utf-8');

const preSummarizeSrc = readFileSync(new URL('../../src/pre-summarize/index.ts', import.meta.url), 'utf-8');

// ── CQ-002 — Tool result truncation in chat handler ───────────────────

describe('CQ-002 — Tool result truncation', () => {
  it('defines MAX_TOOL_RESULT_CHARS constant', () => {
    assert.ok(
      chatHandler.includes('MAX_TOOL_RESULT_CHARS'),
      'handler should define MAX_TOOL_RESULT_CHARS for per-tool truncation',
    );
  });

  it('defines MAX_TOTAL_TOOL_RESULT_CHARS constant', () => {
    assert.ok(
      chatHandler.includes('MAX_TOTAL_TOOL_RESULT_CHARS'),
      'handler should define MAX_TOTAL_TOOL_RESULT_CHARS for total budget',
    );
  });

  it('MAX_TOOL_RESULT_CHARS is a positive number', () => {
    const match = chatHandler.match(/MAX_TOOL_RESULT_CHARS\s*=\s*(\d[\d_]*)/);
    assert.ok(match, 'MAX_TOOL_RESULT_CHARS should have a numeric value');
    const value = Number(match![1].replace(/_/g, ''));
    assert.ok(value > 0, 'MAX_TOOL_RESULT_CHARS should be positive');
  });

  it('MAX_TOTAL_TOOL_RESULT_CHARS is larger than MAX_TOOL_RESULT_CHARS', () => {
    const perTool = chatHandler.match(/const MAX_TOOL_RESULT_CHARS\s*=\s*(\d[\d_]*)/);
    const total = chatHandler.match(/const MAX_TOTAL_TOOL_RESULT_CHARS\s*=\s*(\d[\d_]*)/);
    assert.ok(perTool && total, 'both constants should be defined');
    const perToolVal = Number(perTool![1].replace(/_/g, ''));
    const totalVal = Number(total![1].replace(/_/g, ''));
    assert.ok(totalVal > perToolVal, 'total budget should exceed per-tool limit');
  });

  it('calls truncateToolResult inside the tool execution loop', () => {
    assert.ok(chatHandler.includes('truncateToolResult'), 'handler should call truncateToolResult on each tool result');
  });

  it('tracks totalToolResultChars in the tool loop', () => {
    assert.ok(
      chatHandler.includes('totalToolResultChars'),
      'handler should accumulate totalToolResultChars across tool calls',
    );
  });

  it('checks totalToolResultChars against MAX_TOTAL_TOOL_RESULT_CHARS', () => {
    assert.ok(
      chatHandler.includes('totalToolResultChars >= MAX_TOTAL_TOOL_RESULT_CHARS'),
      'handler should guard against exceeding the total tool result budget',
    );
  });
});

// ── CQ-010 — ALLOWED_TABLES allowlist in chat tools ──────────────────

describe('CQ-010 — ALLOWED_TABLES allowlist in chat tools', () => {
  it('defines ALLOWED_TABLES mapping', () => {
    assert.ok(chatTools.includes('ALLOWED_TABLES'), 'tools should define ALLOWED_TABLES for SQL table validation');
  });

  it('ALLOWED_TABLES has summary key', () => {
    assert.ok(
      chatTools.includes("summary: 'summaries'") || chatTools.includes('summary: "summaries"'),
      'ALLOWED_TABLES should map summary to summaries table',
    );
  });

  it('ALLOWED_TABLES has report key', () => {
    assert.ok(
      chatTools.includes("report: 'reports'") || chatTools.includes('report: "reports"'),
      'ALLOWED_TABLES should map report to reports table',
    );
  });

  it('guards against invalid type with ALLOWED_TABLES lookup', () => {
    assert.ok(chatTools.includes('if (!table)'), 'should guard against invalid type when table lookup fails');
  });

  it('SQL query uses validated table variable, not raw type', () => {
    // The SELECT query should interpolate `table` (the validated value), not `type`
    const selectMatch = chatTools.match(/SELECT.*FROM \$\{table\}/);
    assert.ok(selectMatch, 'SQL query should use ${table} (validated via ALLOWED_TABLES), not raw type parameter');
  });
});

// ── LC-001 — vectorCache.load() before startServer() ─────────────────

describe('LC-001 — vectorCache.load() before startServer()', () => {
  it('vectorCache.load() appears in index.ts', () => {
    assert.ok(indexSrc.includes('vectorCache.load()'), 'index.ts should call vectorCache.load()');
  });

  it('startServer() appears in index.ts', () => {
    assert.ok(indexSrc.includes('startServer('), 'index.ts should call startServer()');
  });

  it('vectorCache.load() appears before startServer() in source order', () => {
    const loadPos = indexSrc.indexOf('vectorCache.load()');
    const startPos = indexSrc.indexOf('startServer(');
    assert.ok(loadPos > -1, 'vectorCache.load() should exist');
    assert.ok(startPos > -1, 'startServer() should exist');
    assert.ok(
      loadPos < startPos,
      `vectorCache.load() (pos ${loadPos}) should appear before startServer() (pos ${startPos})`,
    );
  });
});

// ── LC-005 — shuttingDown guard in refreshDailyCron ──────────────────

describe('LC-005 — shuttingDown guard in refreshDailyCron', () => {
  it('refreshDailyCron function exists in scheduler', () => {
    assert.ok(schedulerSrc.includes('refreshDailyCron'), 'scheduler should define refreshDailyCron');
  });

  it('shuttingDown guard is at the top of refreshDailyCron body', () => {
    // Extract the refreshDailyCron function body
    const fnStart = schedulerSrc.indexOf('async function refreshDailyCron');
    assert.ok(fnStart > -1, 'should find refreshDailyCron function');

    // Find the opening brace of the function
    const bracePos = schedulerSrc.indexOf('{', fnStart);
    assert.ok(bracePos > -1, 'should find opening brace');

    // The shuttingDown check should appear shortly after the opening brace
    const bodyStart = schedulerSrc.slice(bracePos, bracePos + 100);
    assert.ok(
      bodyStart.includes('if (shuttingDown) return'),
      'refreshDailyCron should have shuttingDown guard at the top of its body',
    );
  });
});

// ── IP-001 — Pre-summarize sets batch_id ─────────────────────────────

describe('IP-001 — Pre-summarize sets batch_id', () => {
  it('generates a ULID batch_id', () => {
    assert.ok(preSummarizeSrc.includes('ulid()'), 'pre-summarize should generate a ULID for batch_id');
  });

  it('claim UPDATE query includes batch_id', () => {
    // The claim query (UPDATE items SET status = 'processing') should also set batch_id
    const claimStart = preSummarizeSrc.indexOf("UPDATE items SET status = 'processing'");
    assert.ok(claimStart > -1, 'should find the claim query');

    // Get the claim query text (up to RETURNING)
    const claimEnd = preSummarizeSrc.indexOf('RETURNING', claimStart);
    assert.ok(claimEnd > -1, 'claim query should have RETURNING clause');
    const claimQuery = preSummarizeSrc.slice(claimStart, claimEnd);

    assert.ok(claimQuery.includes('batch_id'), 'claim query should set batch_id alongside status = processing');
  });
});

// ── IP-004 — LLM error increments retry_count ───────────────────────

describe('IP-004 — LLM error increments retry_count', () => {
  it('catch block contains UPDATE that increments retry_count', () => {
    // Find the catch block for LLM errors in pre-summarize
    const catchIndex = preSummarizeSrc.indexOf('catch (err');
    assert.ok(catchIndex > -1, 'pre-summarize should have a catch block');

    // There may be multiple catch blocks — find the one with the LLM error comment
    const llmCatchIndex = preSummarizeSrc.indexOf('LLM call failed');
    assert.ok(llmCatchIndex > -1, 'should find the LLM error catch block');

    // Get text from the LLM error message to the end of the catch block (generous slice)
    const afterCatch = preSummarizeSrc.slice(llmCatchIndex, llmCatchIndex + 500);

    assert.ok(
      afterCatch.includes('retry_count = retry_count + 1'),
      'LLM error catch block should increment retry_count',
    );
  });

  it('catch block sets status back to ready', () => {
    const llmCatchIndex = preSummarizeSrc.indexOf('LLM call failed');
    assert.ok(llmCatchIndex > -1, 'should find the LLM error catch block');

    const afterCatch = preSummarizeSrc.slice(llmCatchIndex, llmCatchIndex + 500);

    assert.ok(
      afterCatch.includes("status = 'ready'"),
      'LLM error catch block should release items back to ready status',
    );
  });

  it('IP-004 fix is documented in the catch block comment', () => {
    assert.ok(
      preSummarizeSrc.includes('IP-004'),
      'pre-summarize should have IP-004 comment documenting the retry_count increment fix',
    );
  });
});
