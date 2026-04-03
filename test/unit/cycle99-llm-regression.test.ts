/**
 * Cycle-99 structural regression tests for LLM fixes.
 *
 * LM-020: extractHttpStatus checks structured properties (status/statusCode)
 *         before falling back to regex, and regex uses negative lookahead to
 *         avoid matching strings like "432ms".
 *
 * LM-025: sanitizeForPrompt escapes & before < and >, ensuring pre-existing
 *         entities like &lt; become &amp;lt; (not double-escaped incorrectly).
 *
 * These are source-level pattern tests — they read the TypeScript source
 * and assert structural invariants. No runtime imports of the modules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const llmSrc = readFileSync(
  new URL('../../src/llm.ts', import.meta.url), 'utf-8',
);

// ── LM-020 — extractHttpStatus ───────────────────────────────────────

describe('LM-020 — extractHttpStatus checks structured properties first', () => {
  it('checks status or statusCode property before the regex fallback', () => {
    const fnIdx = llmSrc.indexOf('function extractHttpStatus(');
    assert.ok(fnIdx > -1, 'should find extractHttpStatus declaration');

    // Find next function boundary to scope the search
    const afterFn = llmSrc.slice(fnIdx);
    const nextFnIdx = afterFn.indexOf('\nexport function ', 1);
    const fnBody = nextFnIdx > -1 ? afterFn.slice(0, nextFnIdx) : afterFn;

    const statusPropIdx = fnBody.indexOf("record['status']");
    assert.ok(statusPropIdx > -1, 'must check record[\'status\'] property');

    const statusCodePropIdx = fnBody.indexOf("record['statusCode']");
    assert.ok(statusCodePropIdx > -1, 'must check record[\'statusCode\'] property');

    const regexIdx = fnBody.indexOf('.exec(msg)');
    assert.ok(regexIdx > -1, 'must have regex fallback with .exec(msg)');

    assert.ok(
      statusPropIdx < regexIdx,
      'status property check must come BEFORE the regex fallback',
    );
    assert.ok(
      statusCodePropIdx < regexIdx,
      'statusCode property check must come BEFORE the regex fallback',
    );
  });
});

describe('LM-020 — extractHttpStatus regex uses negative lookahead', () => {
  it('regex contains (?!\\w) negative lookahead to reject "432ms" etc.', () => {
    const fnIdx = llmSrc.indexOf('function extractHttpStatus(');
    assert.ok(fnIdx > -1, 'should find extractHttpStatus declaration');

    const afterFn = llmSrc.slice(fnIdx);
    const nextFnIdx = afterFn.indexOf('\nexport function ', 1);
    const fnBody = nextFnIdx > -1 ? afterFn.slice(0, nextFnIdx) : afterFn;

    // The regex should contain a negative lookahead (?!\w) after the digit pattern
    assert.ok(
      fnBody.includes('(?!\\w)'),
      'regex must use negative lookahead (?!\\w) to avoid matching digit-sequences followed by word chars',
    );
  });
});

// ── LM-025 — sanitizeForPrompt ───────────────────────────────────────

describe('LM-025 — sanitizeForPrompt escapes & before <>', () => {
  it('replaces & with &amp;', () => {
    const fnIdx = llmSrc.indexOf('function sanitizeForPrompt(');
    assert.ok(fnIdx > -1, 'should find sanitizeForPrompt declaration');

    const afterFn = llmSrc.slice(fnIdx);
    const nextFnIdx = afterFn.indexOf('\n  function ', 1);
    const fnBody = nextFnIdx > -1 ? afterFn.slice(0, nextFnIdx) : afterFn;

    assert.ok(
      fnBody.includes("'&amp;'") || fnBody.includes('"&amp;"'),
      'sanitizeForPrompt must replace & with &amp;',
    );
  });

  it('& replacement comes BEFORE < replacement (line ordering)', () => {
    const fnIdx = llmSrc.indexOf('function sanitizeForPrompt(');
    assert.ok(fnIdx > -1, 'should find sanitizeForPrompt declaration');

    const afterFn = llmSrc.slice(fnIdx);
    const nextFnIdx = afterFn.indexOf('\n  function ', 1);
    const fnBody = nextFnIdx > -1 ? afterFn.slice(0, nextFnIdx) : afterFn;

    const ampIdx = fnBody.indexOf('/&/g');
    assert.ok(ampIdx > -1, 'must have /&/g replacement');

    const ltIdx = fnBody.indexOf('/</g');
    assert.ok(ltIdx > -1, 'must have /</g replacement');

    assert.ok(
      ampIdx < ltIdx,
      '& replacement must come BEFORE < replacement so pre-existing &lt; becomes &amp;lt;',
    );
  });

  it('still replaces < with &lt; and > with &gt;', () => {
    const fnIdx = llmSrc.indexOf('function sanitizeForPrompt(');
    assert.ok(fnIdx > -1, 'should find sanitizeForPrompt declaration');

    const afterFn = llmSrc.slice(fnIdx);
    const nextFnIdx = afterFn.indexOf('\n  function ', 1);
    const fnBody = nextFnIdx > -1 ? afterFn.slice(0, nextFnIdx) : afterFn;

    assert.ok(
      fnBody.includes("'&lt;'") || fnBody.includes('"&lt;"'),
      'sanitizeForPrompt must replace < with &lt;',
    );
    assert.ok(
      fnBody.includes("'&gt;'") || fnBody.includes('"&gt;"'),
      'sanitizeForPrompt must replace > with &gt;',
    );
  });
});
