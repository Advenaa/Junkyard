import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createConversationManager,
  MAX_CONVERSATIONS_PER_USER,
  MAX_CONVERSATIONS_TOTAL,
  MAX_MESSAGES,
  IDLE_TIMEOUT_MS,
} from '../../src/chat/conversations.js';
import type { ConversationManager } from '../../src/chat/conversations.js';

describe('ConversationManager', () => {
  let mgr: ConversationManager;

  beforeEach(() => {
    mgr = createConversationManager();
  });

  // ── 1. Basic add and get ───────────────────────────────────────────

  it('returns messages after adding them', () => {
    mgr.add('conv-1', 'user-a', 'user', 'hello');
    mgr.add('conv-1', 'user-a', 'assistant', 'hi there');

    const msgs = mgr.get('conv-1', 'user-a');
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, 'user');
    assert.equal(msgs[0].content, 'hello');
    assert.equal(msgs[1].role, 'assistant');
    assert.equal(msgs[1].content, 'hi there');
  });

  it('returns empty array for unknown conversation', () => {
    assert.deepEqual(mgr.get('nonexistent', 'user-a'), []);
  });

  // ── 2. Per-user cap ────────────────────────────────────────────────

  it('evicts oldest conversation when per-user cap is exceeded', () => {
    // Create MAX_CONVERSATIONS_PER_USER conversations for one user
    for (let i = 0; i < MAX_CONVERSATIONS_PER_USER; i++) {
      mgr.add(`conv-${i}`, 'user-a', 'user', `msg-${i}`);
    }

    // All should exist
    for (let i = 0; i < MAX_CONVERSATIONS_PER_USER; i++) {
      assert.equal(mgr.get(`conv-${i}`, 'user-a').length, 1, `conv-${i} should exist`);
    }

    // Add one more — should evict conv-0 (oldest)
    mgr.add('conv-overflow', 'user-a', 'user', 'overflow');

    assert.deepEqual(mgr.get('conv-0', 'user-a'), [], 'conv-0 should be evicted');
    assert.equal(mgr.get('conv-overflow', 'user-a').length, 1, 'new conversation should exist');
  });

  // ── 3. Total cap ──────────────────────────────────────────────────

  it('evicts oldest conversation when total cap is exceeded', () => {
    // Fill to MAX_CONVERSATIONS_TOTAL across many users
    for (let i = 0; i < MAX_CONVERSATIONS_TOTAL; i++) {
      mgr.add(`conv-${i}`, `user-${i}`, 'user', `msg-${i}`);
    }

    // conv-0 should still exist
    assert.equal(mgr.get('conv-0', 'user-0').length, 1);

    // Add one more — should evict conv-0 (oldest by lastAccess)
    // Note: get() above touched conv-0's lastAccess, so re-create the manager
    mgr = createConversationManager();
    for (let i = 0; i < MAX_CONVERSATIONS_TOTAL; i++) {
      mgr.add(`conv-${i}`, `user-${i}`, 'user', `msg-${i}`);
    }
    mgr.add('conv-overflow', 'user-new', 'user', 'overflow');

    assert.deepEqual(mgr.get('conv-0', 'user-0'), [], 'conv-0 should be evicted');
    assert.equal(mgr.get('conv-overflow', 'user-new').length, 1, 'new conversation should exist');
  });

  // ── 4. Cross-user isolation ────────────────────────────────────────

  it('does not return messages for a different user', () => {
    mgr.add('conv-1', 'user-a', 'user', 'secret message');

    assert.deepEqual(mgr.get('conv-1', 'user-b'), [], 'user-b should not see user-a messages');
  });

  it('rejects add from a different user on an existing conversation', () => {
    mgr.add('conv-1', 'user-a', 'user', 'original');
    mgr.add('conv-1', 'user-b', 'user', 'intruder');

    const msgs = mgr.get('conv-1', 'user-a');
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].content, 'original', 'intruder message should be rejected');
  });

  // ── 5. Idle cleanup ───────────────────────────────────────────────

  it('removes conversations that exceed idle timeout', () => {
    mgr.add('conv-1', 'user-a', 'user', 'will expire');
    mgr.add('conv-2', 'user-a', 'user', 'will stay');

    // Monkey-patch Date.now to simulate time passage for cleanup
    const realNow = Date.now;
    try {
      // First, touch conv-2 so it's recent
      Date.now = () => realNow() + IDLE_TIMEOUT_MS + 1;
      // conv-2 gets touched by a get, conv-1 does not
      mgr.get('conv-2', 'user-a');

      // Now advance time further and run cleanup
      Date.now = () => realNow() + 2 * IDLE_TIMEOUT_MS + 2;
      mgr.cleanup();

      // conv-1 was last accessed at original time, which is now > IDLE_TIMEOUT_MS ago
      assert.deepEqual(mgr.get('conv-1', 'user-a'), [], 'conv-1 should be cleaned up');
      // conv-2 was touched at IDLE_TIMEOUT_MS+1, so at 2*IDLE_TIMEOUT_MS+2 it's also expired
    } finally {
      Date.now = realNow;
    }
  });

  it('keeps conversations that are still within idle timeout', () => {
    mgr.add('conv-1', 'user-a', 'user', 'still fresh');

    const realNow = Date.now;
    try {
      // Advance just under the timeout
      Date.now = () => realNow() + IDLE_TIMEOUT_MS - 1000;
      mgr.cleanup();

      assert.equal(mgr.get('conv-1', 'user-a').length, 1, 'fresh conversation should survive cleanup');
    } finally {
      Date.now = realNow;
    }
  });

  // ── 6. Message limit ──────────────────────────────────────────────

  it('trims messages to MAX_MESSAGES', () => {
    for (let i = 0; i < MAX_MESSAGES + 20; i++) {
      mgr.add('conv-1', 'user-a', 'user', `msg-${i}`);
    }

    const msgs = mgr.get('conv-1', 'user-a');
    assert.equal(msgs.length, MAX_MESSAGES, `should be trimmed to ${MAX_MESSAGES}`);
    // Should keep the latest messages (slice from the end)
    assert.equal(msgs[0].content, 'msg-20', 'first message should be msg-20 (oldest kept)');
    assert.equal(msgs[msgs.length - 1].content, `msg-${MAX_MESSAGES + 19}`, 'last message should be the newest');
  });
});
