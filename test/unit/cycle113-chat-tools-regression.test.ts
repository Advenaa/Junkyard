/**
 * Structural regression tests for cycle 113 findings.
 *
 * CH-017: Semantic search truncates each result body to 300 chars before nonce wrapping
 * CH-010: created_at displayed as YYYY-MM-DD (epoch-ms converted to date string)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

// ===========================================================================
// CH-017: Semantic search truncates each result to 300 chars
// ===========================================================================

describe('CH-017: semantic_search truncates each result body to 300 chars', () => {
  const src = readSrc('src/chat/tools.ts');

  it('contains a .slice(0, 300) call or > 300 length check for truncation', () => {
    const hasSlice = src.includes('.slice(0, 300)');
    const hasLengthCheck = />\s*300/.test(src);
    assert.ok(
      hasSlice || hasLengthCheck,
      'tools.ts must contain .slice(0, 300) or a > 300 length check for per-result truncation',
    );
  });

  it('truncation (.slice(0, 300)) appears BEFORE wrapNonce call in the source', () => {
    // Find the semantic_search execute block: truncation must come before wrapNonce
    const sliceIndex = src.indexOf('.slice(0, 300)');
    assert.ok(sliceIndex !== -1, '.slice(0, 300) must exist in tools.ts');

    // Find the wrapNonce call that wraps search_result — must come after truncation
    const wrapNonceIndex = src.indexOf("wrapNonce('search_result'", sliceIndex);
    assert.ok(
      wrapNonceIndex !== -1 && wrapNonceIndex > sliceIndex,
      'wrapNonce(\'search_result\', ...) must appear AFTER .slice(0, 300) — truncation before wrapping',
    );
  });

  it('uses truncatedBody (or similar) variable between slice and wrapNonce', () => {
    assert.match(
      src,
      /truncatedBody/,
      'tools.ts should use a truncatedBody variable for the sliced content',
    );
  });
});

// ===========================================================================
// CH-010: created_at displayed as YYYY-MM-DD
// ===========================================================================

describe('CH-010: semantic_search displays created_at as YYYY-MM-DD', () => {
  const src = readSrc('src/chat/tools.ts');

  it('converts epoch-ms via .toISOString().slice(0, 10)', () => {
    assert.ok(
      src.includes('.toISOString().slice(0, 10)'),
      'tools.ts must convert created_at using .toISOString().slice(0, 10) for YYYY-MM-DD',
    );
  });

  it('creates a Date from epochMs via new Date(epochMs)', () => {
    assert.match(
      src,
      /new\s+Date\(epochMs\)/,
      'tools.ts must create a Date from epochMs for ISO conversion',
    );
  });

  it('result line includes "date:" with the converted dateStr (not raw epoch)', () => {
    // The output format should include `date: ${dateStr}` where dateStr is the converted value
    assert.match(
      src,
      /date:\s*\$\{dateStr\}/,
      'result line must include date: ${dateStr} using the converted date string',
    );
  });

  it('does not output raw createdAt in the result line', () => {
    // The line that builds the result string should use dateStr, not entry.createdAt
    const resultLineMatch = src.match(/lines\.push\(\s*`\[.*?date:.*?\]/s);
    if (resultLineMatch) {
      assert.ok(
        !resultLineMatch[0].includes('entry.createdAt'),
        'result line must use dateStr, not raw entry.createdAt',
      );
    }
    // Even without the match, dateStr presence is verified by other assertions
  });

  it('guards against non-epoch values with Number.isFinite check', () => {
    assert.match(
      src,
      /Number\.isFinite\(epochMs\)/,
      'tools.ts must guard epoch-ms conversion with Number.isFinite check',
    );
  });
});
