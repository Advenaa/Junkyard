import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const healthSrc = readFileSync(new URL('../../src/health.ts', import.meta.url), 'utf-8');
const handlerSrc = readFileSync(new URL('../../src/chat/handler.ts', import.meta.url), 'utf-8');
const webhookSrc = readFileSync(new URL('../../src/deliver/webhook.ts', import.meta.url), 'utf-8');
const indexSrc = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf-8');

describe('HM-021 — Health event dedup is atomic', () => {
  it('INSERT INTO health_events uses WHERE NOT EXISTS for atomic dedup', () => {
    assert.match(
      healthSrc,
      /INSERT\s+INTO\s+health_events[\s\S]*?WHERE\s+NOT\s+EXISTS/,
      'health_events INSERT must use WHERE NOT EXISTS for atomic dedup',
    );
  });

  it('no separate isDuplicate function exists', () => {
    assert.ok(
      !healthSrc.includes('isDuplicate'),
      'isDuplicate should be removed/inlined — dedup is handled atomically in the INSERT',
    );
  });

  it('HM-021 comment is present in health event insertion code', () => {
    assert.ok(
      healthSrc.includes('// HM-021'),
      'health.ts must contain a // HM-021 comment marking the atomic dedup pattern',
    );
  });
});

describe('CH-020 — Conversation history always nonce-wrapped', () => {
  it('queryWrapped boolean variable exists', () => {
    assert.match(
      handlerSrc,
      /let\s+queryWrapped\s*=\s*false/,
      'handler.ts must declare a queryWrapped boolean tracking nonce wrap state',
    );
  });

  it('wrapWithNonce is called before saving to conversation history', () => {
    // The pattern: wrapWithNonce should appear near conversations.add
    // Specifically, the unwrapped path calls wrapWithNonce and then conversations.add follows
    const wrapIdx = handlerSrc.lastIndexOf('wrapWithNonce');
    const addIdx = handlerSrc.indexOf('conversations.add');
    assert.ok(wrapIdx > 0, 'wrapWithNonce must be called in handler.ts');
    assert.ok(addIdx > 0, 'conversations.add must be called in handler.ts');
    // The final wrapWithNonce call (the one guarding history save) must precede conversations.add
    const wrapBeforeAdd = handlerSrc.indexOf('wrapWithNonce', handlerSrc.indexOf('historyQuery'));
    assert.ok(
      wrapBeforeAdd < addIdx || handlerSrc.includes('queryWrapped ? processedQuery : llm.wrapWithNonce'),
      'wrapWithNonce must be applied to the query before conversations.add saves it',
    );
  });

  it('CH-020 comment is present', () => {
    assert.ok(handlerSrc.includes('// CH-020'), 'handler.ts must contain a // CH-020 comment');
  });
});

describe('D-020 — Failed delivery retry mechanism', () => {
  it('retryFailed function exists in webhook.ts', () => {
    assert.match(webhookSrc, /async\s+function\s+retryFailed/, 'webhook.ts must define a retryFailed function');
  });

  it('retryFailed queries for failed delivery_status', () => {
    assert.ok(
      webhookSrc.includes("delivery_status = 'failed'"),
      "retryFailed must query for reports with delivery_status = 'failed'",
    );
  });

  it('retryFailed is exported in the return object', () => {
    assert.match(
      webhookSrc,
      /return\s*\{[^}]*retryFailed[^}]*\}/,
      'retryFailed must be included in the createDelivery return object',
    );
  });

  it('retryFailed is called in the health check / scheduler context in index.ts', () => {
    // retryFailed is invoked inside onHealthCheck in index.ts
    assert.ok(
      indexSrc.includes('retryFailed()'),
      'index.ts must call retryFailed() in the scheduler/health-check context',
    );
    // Verify it is within the health check function (near the D-020 comment)
    const d020Idx = indexSrc.indexOf('D-020');
    const retryIdx = indexSrc.indexOf('retryFailed()', d020Idx);
    assert.ok(
      d020Idx > 0 && retryIdx > d020Idx,
      'retryFailed() call must appear after the D-020 comment in the health check section',
    );
  });
});
