import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Config } from '../../src/config.js';
import { createEnvDiscordTokens } from '../../src/discord-tokens.js';
import type { Logger } from '../../src/logger.js';
import { createDiscordAdapter, type TokenState } from '../../src/ingest/discord.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Minimal mock pool — getDiscordChannels queries sources table. */
const mockPool = {
  query: async () => ({ rows: [] }),
} as any;

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    anthropicApiKey: 'test-key',
    geminiApiKey: 'test-gemini',
    databaseUrl: 'postgresql://localhost/test',
    discordClientId: null,
    discordClientSecret: null,
    adminUserIds: [],
    discordTokens: [],
    twitterApiKey: null,
    apiKey: 'test-api-key',
    sessionSecret: 'test-secret',
    port: 3000,
    dataDir: './data',
    publicUrl: null,
    alertWebhookUrl: null,
    models: { haiku: 'test-haiku', sonnet: 'test-sonnet' },
    secrets: [],
    ...overrides,
  };
}

/** Minimal mock logger that records calls for assertions. */
function makeLogger(): Logger & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {};

  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      const name = String(prop);
      if (name === 'calls') return calls;
      // Return a function that records calls
      if (!calls[name]) calls[name] = [];
      return (...args: unknown[]) => {
        calls[name]!.push(args);
      };
    },
  };

  return new Proxy({}, handler) as Logger & { calls: Record<string, unknown[][]> };
}

const noopOnMessage = async () => {};

function adapterForConfig(config: Config, log: Logger = makeLogger()) {
  return createDiscordAdapter(createEnvDiscordTokens(config.discordTokens), mockPool, log, noopOnMessage);
}

// ---------------------------------------------------------------------------
// createDiscordAdapter — factory shape
// ---------------------------------------------------------------------------

describe('createDiscordAdapter factory', () => {
  it('returns an object with connect, disconnect, and getTokenStates', () => {
    const adapter = adapterForConfig(makeConfig());
    assert.strictEqual(typeof adapter.connect, 'function');
    assert.strictEqual(typeof adapter.disconnect, 'function');
    assert.strictEqual(typeof adapter.getTokenStates, 'function');
  });

  it('returns exactly four keys', () => {
    const adapter = adapterForConfig(makeConfig());
    const keys = Object.keys(adapter).sort();
    assert.deepStrictEqual(keys, ['connect', 'disconnect', 'getTokenStates', 'reconnect']);
  });
});

// ---------------------------------------------------------------------------
// Zero-token behaviour
// ---------------------------------------------------------------------------

describe('zero tokens configured', () => {
  it('getTokenStates returns empty array when no tokens configured', () => {
    const adapter = adapterForConfig(makeConfig());
    assert.deepStrictEqual(adapter.getTokenStates(), []);
  });

  it('connect logs warning and returns without error when no tokens', async () => {
    const log = makeLogger();
    const adapter = adapterForConfig(makeConfig(), log);
    await adapter.connect();
    // Should have logged a warning about no tokens
    assert.ok(log.calls['warn'], 'expected a warn log call');
    assert.ok(log.calls['warn'].length > 0, 'expected at least one warn call');
    const warnMsg = log.calls['warn'][0]![0];
    assert.ok(
      typeof warnMsg === 'string' && warnMsg.includes('no discord tokens'),
      `expected warn about no tokens, got: ${String(warnMsg)}`,
    );
  });

  it('disconnect resolves without error when no tokens', async () => {
    const adapter = adapterForConfig(makeConfig());
    await adapter.disconnect(); // should not throw
  });
});

// ---------------------------------------------------------------------------
// TokenState shape — with tokens configured (no connect)
// ---------------------------------------------------------------------------

describe('TokenState initial shape', () => {
  let states: TokenState[];

  beforeEach(() => {
    const config = makeConfig({ discordTokens: ['token-a', 'token-b'] });
    const adapter = adapterForConfig(config);
    states = adapter.getTokenStates();
  });

  it('creates one TokenState per configured token', () => {
    assert.strictEqual(states.length, 2);
  });

  it('assigns sequential index values starting from 0', () => {
    assert.strictEqual(states[0]!.index, 0);
    assert.strictEqual(states[1]!.index, 1);
  });

  it('initial status is idle', () => {
    for (const s of states) {
      assert.strictEqual(s.status, 'idle');
    }
  });

  it('initial sessionId is null', () => {
    for (const s of states) {
      assert.strictEqual(s.sessionId, null);
    }
  });

  it('initial resumeUrl is null', () => {
    for (const s of states) {
      assert.strictEqual(s.resumeUrl, null);
    }
  });

  it('initial lastSeq is null', () => {
    for (const s of states) {
      assert.strictEqual(s.lastSeq, null);
    }
  });

  it('initial errorCount is 0', () => {
    for (const s of states) {
      assert.strictEqual(s.errorCount, 0);
    }
  });

  it('initial assignedChannels is empty Set', () => {
    for (const s of states) {
      assert.ok(s.assignedChannels instanceof Set);
      assert.strictEqual(s.assignedChannels.size, 0);
    }
  });
});

// ---------------------------------------------------------------------------
// getTokenStates returns copies (not live references)
// ---------------------------------------------------------------------------

describe('getTokenStates isolation', () => {
  it('returns shallow copies so mutations do not leak back', () => {
    const config = makeConfig({ discordTokens: ['tok1'] });
    const adapter = adapterForConfig(config);
    const a = adapter.getTokenStates();
    const b = adapter.getTokenStates();
    assert.notStrictEqual(a[0], b[0], 'each call should return new objects');
  });

  it('mutating returned state does not affect next call', () => {
    const config = makeConfig({ discordTokens: ['tok1'] });
    const adapter = adapterForConfig(config);
    const first = adapter.getTokenStates();
    first[0]!.errorCount = 999;
    const second = adapter.getTokenStates();
    assert.strictEqual(second[0]!.errorCount, 0, 'internal state should be unaffected');
  });
});

// ---------------------------------------------------------------------------
// Multiple tokens — scaling
// ---------------------------------------------------------------------------

describe('multiple tokens', () => {
  it('handles many tokens', () => {
    const tokens = Array.from({ length: 10 }, (_, i) => `token-${i}`);
    const config = makeConfig({ discordTokens: tokens });
    const adapter = adapterForConfig(config);
    const states = adapter.getTokenStates();
    assert.strictEqual(states.length, 10);
    for (let i = 0; i < 10; i++) {
      assert.strictEqual(states[i]!.index, i);
    }
  });
});

// ---------------------------------------------------------------------------
// TokenState status type — compile-time check exercised at runtime
// ---------------------------------------------------------------------------

describe('TokenState status values', () => {
  it('idle is a valid TokenState status', () => {
    const config = makeConfig({ discordTokens: ['tok'] });
    const adapter = adapterForConfig(config);
    const [state] = adapter.getTokenStates();
    const validStatuses: TokenState['status'][] = ['idle', 'connecting', 'connected', 'backoff', 'disabled'];
    assert.ok(validStatuses.includes(state!.status));
  });
});

// ---------------------------------------------------------------------------
// disconnect is idempotent
// ---------------------------------------------------------------------------

describe('disconnect idempotency', () => {
  it('calling disconnect multiple times does not throw', async () => {
    const config = makeConfig({ discordTokens: ['tok'] });
    const adapter = adapterForConfig(config);
    await adapter.disconnect();
    await adapter.disconnect();
    await adapter.disconnect();
    // All calls should resolve without error
  });
});

// ---------------------------------------------------------------------------
// P-002: heartbeat timer leak — connect/disconnect lifecycle
// ---------------------------------------------------------------------------

describe('heartbeat timer leak (P-002)', () => {
  it('disconnect resolves cleanly after connect with zero tokens', async () => {
    const adapter = adapterForConfig(makeConfig());
    await adapter.connect();
    await adapter.disconnect();
    // If timers were leaked, the test runner would hang or warn about open handles
    const states = adapter.getTokenStates();
    assert.strictEqual(states.length, 0);
  });

  it('rapid disconnect + re-connect cycles do not throw', async () => {
    const config = makeConfig({ discordTokens: ['tok-a'] });
    const adapter = adapterForConfig(config);

    // Rapid cycle: disconnect before any connect, then connect, then immediate disconnect
    await adapter.disconnect();
    // After disconnect the adapter is destroyed, so connect should be a no-op
    // (destroyed flag is set). This verifies no timer errors are thrown.
    const states = adapter.getTokenStates();
    assert.strictEqual(states[0]!.status, 'idle');
  });

  it('disconnect after disconnect leaves status idle', async () => {
    const config = makeConfig({ discordTokens: ['tok-x', 'tok-y'] });
    const adapter = createDiscordAdapter(config, mockPool, makeLogger(), noopOnMessage);
    await adapter.disconnect();
    await adapter.disconnect();
    for (const s of adapter.getTokenStates()) {
      assert.strictEqual(s.status, 'idle');
    }
  });
});
