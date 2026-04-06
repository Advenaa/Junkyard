import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const handlerSrc = readFileSync(new URL('../../src/chat/handler.ts', import.meta.url), 'utf-8');

describe('CH-021 — chat prompt prefers report context for ongoing stories', () => {
  it('system prompt guides ongoing-story questions toward semantic_search type="report"', () => {
    assert.ok(
      handlerSrc.includes('ongoing story') &&
        handlerSrc.includes('semantic_search with type="report"') &&
        handlerSrc.includes('synthesized report context'),
      'handler.ts system prompt must steer ongoing-story questions toward semantic_search type="report"',
    );
  });

  it('semantic_search tool definition explains report mode is for synthesized report context', () => {
    assert.ok(
      handlerSrc.includes('Use report for synthesized report-level context'),
      'semantic_search tool definition must explain when report mode should be used',
    );
  });
});
