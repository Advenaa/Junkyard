import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

describe('Cycle 168: chat tool usage labels preserve report-vs-summary context', () => {
  const handlerSrc = readFileSync(new URL('../../src/chat/handler.ts', import.meta.url), 'utf-8');

  it('records formatted usage labels when tools expose them', () => {
    assert.match(
      handlerSrc,
      /const usageLabel = formatToolUsageLabel\(tool, call\.args\);[\s\S]*toolUsageLabels\.push\(usageLabel\)/,
      'handler.ts must record formatted tool usage labels for the dashboard',
    );
  });

  it('returns formatted usage labels when available', () => {
    assert.match(
      handlerSrc,
      /toolsUsed: toolUsageLabels\.length > 0 \? toolUsageLabels : toolsUsed/,
      'handler.ts must prefer formatted tool usage labels in the chat response',
    );
  });
});
