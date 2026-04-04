/**
 * Structural regression tests for cycle 113 — chat handler.
 *
 * CH-019: No double-sanitization of user queries or tool results.
 * The handler must NOT call sanitizeForPrompt on processedQuery or toolResult.
 * Tool result truncation must use truncateToolResult(toolResult, ...) directly.
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
// CH-019: No double-sanitization in chat handler
// ===========================================================================

describe('CH-019: handler.ts does not double-sanitize queries or tool results', () => {
  const src = readSrc('src/chat/handler.ts');

  it('does NOT call sanitizeForPrompt(processedQuery)', () => {
    assert.ok(
      !src.includes('sanitizeForPrompt(processedQuery)'),
      'handler.ts must NOT contain sanitizeForPrompt(processedQuery) — query sanitization is handled upstream',
    );
  });

  it('does NOT call sanitizeForPrompt(toolResult)', () => {
    assert.ok(
      !src.includes('sanitizeForPrompt(toolResult)'),
      'handler.ts must NOT contain sanitizeForPrompt(toolResult) — tool results should not be double-sanitized',
    );
  });

  it('does NOT call sanitizeForPrompt(sanitizedResult)', () => {
    assert.ok(
      !src.includes('sanitizeForPrompt(sanitizedResult)'),
      'handler.ts must NOT contain sanitizeForPrompt(sanitizedResult) — no sanitized intermediate for tool results',
    );
  });

  it('does NOT call llm.sanitizeForPrompt(toolResult)', () => {
    assert.ok(
      !src.includes('llm.sanitizeForPrompt(toolResult)'),
      'handler.ts must NOT contain llm.sanitizeForPrompt(toolResult)',
    );
  });

  it('truncates tool results via truncateToolResult(toolResult, ...) directly', () => {
    assert.match(
      src,
      /truncateToolResult\(toolResult,/,
      'handler.ts must call truncateToolResult(toolResult, ...) directly without a sanitized intermediate',
    );
  });

  it('does not import or reference sanitizeForPrompt at all (fully removed)', () => {
    // sanitizeForPrompt was fully removed from handler.ts — it is not imported,
    // called, or referenced anywhere in the file.
    assert.ok(
      !src.includes('sanitizeForPrompt'),
      'handler.ts must not reference sanitizeForPrompt at all — it has been fully removed from this module',
    );
  });
});
