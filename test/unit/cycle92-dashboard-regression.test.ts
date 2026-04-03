/**
 * Cycle 92 — Dashboard structural regression tests
 * UI-003: Stale chat response discarded via conversationId ref
 * UI-007: 404 catch-all route
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chatSrc = readFileSync(new URL('../../dashboard/src/pages/Chat.tsx', import.meta.url), 'utf-8');
const routerSrc = readFileSync(new URL('../../dashboard/src/router.tsx', import.meta.url), 'utf-8');

describe('UI-003 — stale chat response guard', () => {
  it('declares conversationIdRef via useRef', () => {
    assert.match(chatSrc, /conversationIdRef\s*=\s*useRef/);
  });

  it('captures requestConversationId from conversationId before the await', () => {
    // requestConversationId must be assigned from conversationId before the fetch
    assert.match(chatSrc, /const\s+requestConversationId\s*=\s*conversationId/);
  });

  it('guards response with conversationIdRef.current !== requestConversationId', () => {
    assert.match(chatSrc, /conversationIdRef\.current\s*!==\s*requestConversationId/);
  });

  it('has the guard in both try and catch blocks', () => {
    const matches = chatSrc.match(/conversationIdRef\.current\s*!==\s*requestConversationId/g);
    assert.ok(matches, 'guard pattern not found');
    assert.ok(matches.length >= 2, `expected guard in try+catch (at least 2 occurrences), found ${matches.length}`);
  });
});

describe('UI-007 — 404 catch-all route', () => {
  it('has a catch-all path="*" route', () => {
    assert.match(routerSrc, /path="\*"/);
  });

  it('renders "Page not found" text', () => {
    assert.match(routerSrc, /Page not found/i);
  });

  it('contains a link back to /', () => {
    assert.match(routerSrc, /href="\/"/);
  });

  it('catch-all is inside ProtectedRoute layout', () => {
    // path="*" must appear after <ProtectedRoute /> in the source
    const protectedIdx = routerSrc.indexOf('ProtectedRoute');
    const catchAllIdx = routerSrc.indexOf('path="*"');
    assert.ok(protectedIdx > -1, 'ProtectedRoute not found');
    assert.ok(catchAllIdx > protectedIdx, 'catch-all route must be nested inside ProtectedRoute');
  });
});
