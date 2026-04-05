// ── Types ──────────────────────────────────────────────────────────────

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ConversationEntry {
  userId: string;
  messages: Message[];
  lastAccess: number;
}

export interface ConversationManager {
  get(conversationId: string, userId: string): Message[];
  add(conversationId: string, userId: string, role: 'user' | 'assistant', content: string): void;
  cleanup(): void;
}

// ── Constants ─────────────────────────────────────────────────────────

export const MAX_MESSAGES = 50;
export const IDLE_TIMEOUT_MS = 3_600_000; // 1 hour
export const MAX_CONVERSATIONS_PER_USER = 10;
export const MAX_CONVERSATIONS_TOTAL = 1000;

// ── Factory ───────────────────────────────────────────────────────────

export function createConversationManager(): ConversationManager {
  const store = new Map<string, ConversationEntry>();

  function get(conversationId: string, userId: string): Message[] {
    const entry = store.get(conversationId);
    if (!entry) return [];
    if (entry.userId !== userId) return [];

    entry.lastAccess = Date.now();
    return entry.messages.slice(-MAX_MESSAGES);
  }

  function add(conversationId: string, userId: string, role: 'user' | 'assistant', content: string): void {
    let entry = store.get(conversationId);
    if (!entry) {
      // Check total cap
      if (store.size >= MAX_CONVERSATIONS_TOTAL) {
        // Evict oldest conversation
        let oldestId: string | null = null;
        let oldestTime = Infinity;
        for (const [id, e] of store) {
          if (e.lastAccess < oldestTime) {
            oldestTime = e.lastAccess;
            oldestId = id;
          }
        }
        if (oldestId) store.delete(oldestId);
      }

      // Check per-user cap
      let userCount = 0;
      let oldestUserId: string | null = null;
      let oldestUserTime = Infinity;
      for (const [id, e] of store) {
        if (e.userId === userId) {
          userCount++;
          if (e.lastAccess < oldestUserTime) {
            oldestUserTime = e.lastAccess;
            oldestUserId = id;
          }
        }
      }
      if (userCount >= MAX_CONVERSATIONS_PER_USER && oldestUserId) {
        store.delete(oldestUserId);
      }

      entry = { userId, messages: [], lastAccess: Date.now() };
      store.set(conversationId, entry);
    }
    if (entry.userId !== userId) return;

    entry.messages.push({ role, content });

    // Trim to last 5 messages
    if (entry.messages.length > MAX_MESSAGES) {
      entry.messages = entry.messages.slice(-MAX_MESSAGES);
    }

    entry.lastAccess = Date.now();
  }

  function cleanup(): void {
    const now = Date.now();
    for (const [id, entry] of store) {
      if (now - entry.lastAccess > IDLE_TIMEOUT_MS) {
        store.delete(id);
      }
    }
  }

  return { get, add, cleanup };
}
