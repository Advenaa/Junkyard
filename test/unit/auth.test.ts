import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SESSIONS_PER_USER,
  SESSION_LIFETIME_DAYS,
  SLIDING_REFRESH_HOURS,
  createSessionManager,
  normalizeUA,
} from '../../src/auth/sessions.js';
import { requireAuth, requireAdmin } from '../../src/auth/middleware.js';
import type { Config } from '../../src/config.js';

// ---------------------------------------------------------------------------
// Helpers: minimal mocks
// ---------------------------------------------------------------------------

/** Build a mock Pool whose .query() returns the given rows/rowCount. */
function mockPool(responses: Array<{ rows?: unknown[]; rowCount?: number }> = []) {
  let callIndex = 0;
  const calls: Array<{ text: string; values: unknown[] }> = [];
  return {
    calls,
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values: values ?? [] });
      const resp = responses[callIndex] ?? { rows: [], rowCount: 0 };
      callIndex++;
      return { rows: resp.rows ?? [], rowCount: resp.rowCount ?? 0 };
    },
  };
}

/** Minimal logger that swallows everything. */
const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => silentLog,
} as never;

/** Partial Config for middleware tests. */
function fakeConfig(overrides: Partial<Config> = {}): Config {
  return {
    anthropicApiKey: '',
    geminiApiKey: '',
    databaseUrl: '',
    discordClientId: null,
    discordClientSecret: null,
    adminUserIds: [],
    discordTokens: [],
    twitterApiKey: null,
    apiKey: 'test-api-key-12345',
    sessionSecret: 'secret',
    port: 3000,
    dataDir: './data',
    publicUrl: null,
    alertWebhookUrl: null,
    models: { haiku: 'h', sonnet: 's' },
    secrets: [],
    ...overrides,
  };
}

/** Build a mock Fastify request. */
function fakeRequest(opts: {
  cookies?: Record<string, string>;
  authorization?: string;
  unsignResult?: { valid: boolean; value: string | null };
  ip?: string;
  userAgent?: string;
} = {}) {
  const req: Record<string, unknown> = {
    cookies: opts.cookies ?? {},
    headers: {
      authorization: opts.authorization ?? undefined,
      'user-agent': opts.userAgent ?? 'TestAgent/1.0',
    },
    ip: opts.ip ?? '127.0.0.1',
    unsignCookie: (_raw: string) =>
      opts.unsignResult ?? { valid: false, value: null },
  };
  return req as never;
}

/** Build a mock Fastify reply that captures status + body. */
function fakeReply() {
  let statusCode: number | undefined;
  let body: unknown;
  const reply = {
    status(code: number) {
      statusCode = code;
      return reply;
    },
    code(code: number) {
      statusCode = code;
      return reply;
    },
    send(payload: unknown) {
      body = payload;
      return reply;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
  return reply;
}

// ===========================================================================
// Session constants & expiry math
// ===========================================================================

describe('Session constants', () => {
  it('MAX_SESSIONS_PER_USER is 5', () => {
    assert.strictEqual(MAX_SESSIONS_PER_USER, 5);
  });

  it('SESSION_LIFETIME_DAYS is 30', () => {
    assert.strictEqual(SESSION_LIFETIME_DAYS, 30);
  });

  it('SLIDING_REFRESH_HOURS is 24', () => {
    assert.strictEqual(SLIDING_REFRESH_HOURS, 24);
  });

  it('session expiry is 30 days in milliseconds from now', () => {
    const expectedMs = SESSION_LIFETIME_DAYS * 24 * 60 * 60 * 1000;
    assert.strictEqual(expectedMs, 30 * 24 * 60 * 60 * 1000);
  });
});

// ===========================================================================
// createSessionManager — with mocked pool
// ===========================================================================

describe('createSessionManager', () => {
  describe('create()', () => {
    it('returns a ULID session ID', async () => {
      const pool = mockPool([
        { rows: [] },  // SELECT existing sessions
        {},             // INSERT
      ]);
      const mgr = createSessionManager(pool as never, silentLog);
      const id = await mgr.create('user-1', '127.0.0.1', 'TestAgent');

      // ULID: 26 uppercase alphanumeric chars
      assert.match(id, /^[0-9A-Z]{26}$/);
    });

    it('inserts session with correct expiry (~30 days)', async () => {
      const pool = mockPool([{ rows: [] }, {}]);
      const mgr = createSessionManager(pool as never, silentLog);
      const before = Date.now();
      await mgr.create('user-1', '127.0.0.1', 'TestAgent');
      const after = Date.now();

      // Second query is the INSERT
      const insertCall = pool.calls[1]!;
      assert.ok(insertCall.text.includes('INSERT INTO sessions'));

      const expiresAt = insertCall.values[4] as number;
      const thirtyDaysMs = SESSION_LIFETIME_DAYS * 24 * 60 * 60 * 1000;
      assert.ok(expiresAt >= before + thirtyDaysMs);
      assert.ok(expiresAt <= after + thirtyDaysMs);
    });

    it('evicts oldest sessions when user has >= MAX', async () => {
      const oldSessions = [{ id: 'old-1' }, { id: 'old-2' }];
      const pool = mockPool([
        { rows: oldSessions }, // SELECT returns overflow sessions
        {},                     // DELETE old sessions
        {},                     // INSERT new session
      ]);
      const mgr = createSessionManager(pool as never, silentLog);
      await mgr.create('user-1', '127.0.0.1', 'TestAgent');

      // Should have 3 queries: SELECT, DELETE, INSERT
      assert.strictEqual(pool.calls.length, 3);
      const deleteCall = pool.calls[1]!;
      assert.ok(deleteCall.text.includes('DELETE FROM sessions'));
      assert.deepStrictEqual(deleteCall.values, [['old-1', 'old-2']]);
    });
  });

  describe('validate()', () => {
    it('returns null for unknown session', async () => {
      const pool = mockPool([{ rows: [] }]);
      const mgr = createSessionManager(pool as never, silentLog);
      const result = await mgr.validate('nonexistent', '127.0.0.1', 'TestAgent');
      assert.strictEqual(result, null);
    });

    it('returns null and deletes expired session', async () => {
      const pool = mockPool([
        {
          rows: [
            {
              discord_id: 'user-1',
              role: 'viewer',
              expires_at: Date.now() - 1000, // expired
              last_refreshed_at: Date.now() - 1000,
              ip_address: '127.0.0.1',
              user_agent: 'TestAgent',
            },
          ],
        },
        {}, // DELETE
      ]);
      const mgr = createSessionManager(pool as never, silentLog);
      const result = await mgr.validate('expired-session', '127.0.0.1', 'TestAgent');

      assert.strictEqual(result, null);
      assert.strictEqual(pool.calls.length, 2);
      assert.ok(pool.calls[1]!.text.includes('DELETE'));
    });

    it('returns user info for valid session', async () => {
      const pool = mockPool([
        {
          rows: [
            {
              discord_id: 'user-1',
              role: 'viewer',
              expires_at: Date.now() + 86400000, // future
              last_refreshed_at: Date.now(),       // recent
              ip_address: '127.0.0.1',
              user_agent: 'TestAgent',
            },
          ],
        },
      ]);
      const mgr = createSessionManager(pool as never, silentLog);
      const result = await mgr.validate('good-session', '127.0.0.1', 'TestAgent');

      assert.deepStrictEqual(result, { discordId: 'user-1', role: 'viewer' });
    });

    it('triggers sliding refresh when stale (>24h)', async () => {
      const staleTime = Date.now() - (SLIDING_REFRESH_HOURS + 1) * 60 * 60 * 1000;
      const pool = mockPool([
        {
          rows: [
            {
              discord_id: 'user-1',
              role: 'admin',
              expires_at: Date.now() + 86400000,
              last_refreshed_at: staleTime,
              ip_address: '127.0.0.1',
              user_agent: 'TestAgent',
            },
          ],
        },
        {}, // UPDATE sliding refresh
      ]);
      const mgr = createSessionManager(pool as never, silentLog);
      await mgr.validate('stale-session', '127.0.0.1', 'TestAgent');

      assert.strictEqual(pool.calls.length, 2);
      assert.ok(pool.calls[1]!.text.includes('UPDATE sessions SET last_refreshed_at'));
    });

    it('does NOT trigger sliding refresh when fresh (<24h)', async () => {
      const freshTime = Date.now() - (SLIDING_REFRESH_HOURS - 1) * 60 * 60 * 1000;
      const pool = mockPool([
        {
          rows: [
            {
              discord_id: 'user-1',
              role: 'viewer',
              expires_at: Date.now() + 86400000,
              last_refreshed_at: freshTime,
              ip_address: '127.0.0.1',
              user_agent: 'TestAgent',
            },
          ],
        },
      ]);
      const mgr = createSessionManager(pool as never, silentLog);
      await mgr.validate('fresh-session', '127.0.0.1', 'TestAgent');

      // Only the SELECT query, no UPDATE
      assert.strictEqual(pool.calls.length, 1);
    });

    it('invalidates session on User-Agent mismatch', async () => {
      const pool = mockPool([
        {
          rows: [
            {
              discord_id: 'user-1',
              role: 'viewer',
              expires_at: Date.now() + 86400000,
              last_refreshed_at: Date.now(),
              ip_address: '127.0.0.1',
              user_agent: 'Mozilla/5.0 Chrome',
            },
          ],
        },
        {}, // DELETE
      ]);
      const mgr = createSessionManager(pool as never, silentLog);
      const result = await mgr.validate('hijacked-session', '127.0.0.1', 'curl/7.88');

      assert.strictEqual(result, null);
      assert.strictEqual(pool.calls.length, 2);
      assert.ok(pool.calls[1]!.text.includes('DELETE'));
    });

    it('allows session with different IP (warns only)', async () => {
      const pool = mockPool([
        {
          rows: [
            {
              discord_id: 'user-1',
              role: 'viewer',
              expires_at: Date.now() + 86400000,
              last_refreshed_at: Date.now(),
              ip_address: '192.168.1.1',
              user_agent: 'TestAgent',
            },
          ],
        },
      ]);
      const mgr = createSessionManager(pool as never, silentLog);
      const result = await mgr.validate('mobile-session', '10.0.0.1', 'TestAgent');

      assert.deepStrictEqual(result, { discordId: 'user-1', role: 'viewer' });
    });
  });

  describe('cleanupExpired()', () => {
    it('returns count of deleted sessions', async () => {
      const pool = mockPool([{ rowCount: 3 }]);
      const mgr = createSessionManager(pool as never, silentLog);
      const count = await mgr.cleanupExpired();
      assert.strictEqual(count, 3);
    });

    it('returns 0 when nothing expired', async () => {
      const pool = mockPool([{ rowCount: 0 }]);
      const mgr = createSessionManager(pool as never, silentLog);
      const count = await mgr.cleanupExpired();
      assert.strictEqual(count, 0);
    });
  });
});

// ===========================================================================
// requireAuth middleware
// ===========================================================================

describe('requireAuth', () => {
  it('authenticates via valid session cookie', async () => {
    const sessionManager = {
      validate: async () => ({ discordId: 'user-42', role: 'viewer' }),
    };
    const pool = mockPool([{ rows: [{ username: 'alice' }] }]);
    const config = fakeConfig();
    const handler = requireAuth(pool as never, config, sessionManager as never);

    const req = fakeRequest({
      cookies: { podders_session: 'signed-cookie' },
      unsignResult: { valid: true, value: 'session-id-abc' },
    });
    const reply = fakeReply();
    await handler(req, reply as never);

    assert.deepStrictEqual((req as Record<string, unknown>).user, {
      discordId: 'user-42',
      username: 'alice',
      role: 'viewer',
    });
  });

  it('promotes to admin when discordId is in ADMIN_USER_IDS', async () => {
    const sessionManager = {
      validate: async () => ({ discordId: 'admin-id-1', role: 'viewer' }),
    };
    const pool = mockPool([{ rows: [{ username: 'bob' }] }]);
    const config = fakeConfig({ adminUserIds: ['admin-id-1', 'admin-id-2'] });
    const handler = requireAuth(pool as never, config, sessionManager as never);

    const req = fakeRequest({
      cookies: { podders_session: 'signed' },
      unsignResult: { valid: true, value: 'sess-xyz' },
    });
    const reply = fakeReply();
    await handler(req, reply as never);

    const user = (req as Record<string, unknown>).user as Record<string, unknown>;
    assert.strictEqual(user.role, 'admin');
    assert.strictEqual(user.discordId, 'admin-id-1');
  });

  it('revokes admin role when discordId is NOT in ADMIN_USER_IDS', async () => {
    const sessionManager = {
      validate: async () => ({ discordId: 'former-admin', role: 'admin' }),
    };
    const pool = mockPool([{ rows: [{ username: 'charlie' }] }]);
    const config = fakeConfig({ adminUserIds: ['other-admin'] }); // former-admin NOT in list
    const handler = requireAuth(pool as never, config, sessionManager as never);

    const req = fakeRequest({
      cookies: { podders_session: 'signed' },
      unsignResult: { valid: true, value: 'sess-abc' },
    });
    const reply = fakeReply();
    await handler(req, reply as never);

    const user = (req as Record<string, unknown>).user as Record<string, unknown>;
    assert.strictEqual(user.role, 'viewer', 'DB admin not in ADMIN_USER_IDS should be demoted to viewer');
    assert.strictEqual(user.discordId, 'former-admin');
  });

  it('falls back to "unknown" username when DB has no user row', async () => {
    const sessionManager = {
      validate: async () => ({ discordId: 'user-99', role: 'viewer' }),
    };
    const pool = mockPool([{ rows: [] }]); // no user row
    const config = fakeConfig();
    const handler = requireAuth(pool as never, config, sessionManager as never);

    const req = fakeRequest({
      cookies: { podders_session: 'signed' },
      unsignResult: { valid: true, value: 'sess-abc' },
    });
    const reply = fakeReply();
    await handler(req, reply as never);

    const user = (req as Record<string, unknown>).user as Record<string, unknown>;
    assert.strictEqual(user.username, 'unknown');
  });

  it('authenticates via valid API key (Bearer header)', async () => {
    const sessionManager = { validate: async () => null };
    const pool = mockPool();
    const config = fakeConfig({ apiKey: 'my-secret-key' });
    const handler = requireAuth(pool as never, config, sessionManager as never);

    const req = fakeRequest({
      authorization: 'Bearer my-secret-key',
      unsignResult: { valid: false, value: null },
    });
    const reply = fakeReply();
    await handler(req, reply as never);

    const user = (req as Record<string, unknown>).user as Record<string, unknown>;
    assert.strictEqual(user.role, 'admin');
    assert.strictEqual(user.discordId, 'api-key');
    assert.strictEqual(user.username, 'api');
  });

  it('rejects wrong API key', async () => {
    const sessionManager = { validate: async () => null };
    const pool = mockPool();
    const config = fakeConfig({ apiKey: 'correct-key-1234' });
    const handler = requireAuth(pool as never, config, sessionManager as never);

    const req = fakeRequest({
      authorization: 'Bearer wrong-key-9999',
      unsignResult: { valid: false, value: null },
    });
    const reply = fakeReply();
    await handler(req, reply as never);

    assert.strictEqual(reply.statusCode, 401);
    assert.deepStrictEqual(reply.body, { error: 'Unauthorized' });
  });

  it('rejects API key with different length (timing-safe)', async () => {
    const sessionManager = { validate: async () => null };
    const pool = mockPool();
    const config = fakeConfig({ apiKey: 'short' });
    const handler = requireAuth(pool as never, config, sessionManager as never);

    const req = fakeRequest({
      authorization: 'Bearer a-much-longer-key-than-expected',
      unsignResult: { valid: false, value: null },
    });
    const reply = fakeReply();
    await handler(req, reply as never);

    assert.strictEqual(reply.statusCode, 401);
  });

  it('returns 401 when no session and no API key', async () => {
    const sessionManager = { validate: async () => null };
    const pool = mockPool();
    const config = fakeConfig();
    const handler = requireAuth(pool as never, config, sessionManager as never);

    const req = fakeRequest({ unsignResult: { valid: false, value: null } });
    const reply = fakeReply();
    await handler(req, reply as never);

    assert.strictEqual(reply.statusCode, 401);
    assert.deepStrictEqual(reply.body, { error: 'Unauthorized' });
  });

  it('returns 401 when session is invalid (validate returns null)', async () => {
    const sessionManager = { validate: async () => null };
    const pool = mockPool();
    const config = fakeConfig();
    const handler = requireAuth(pool as never, config, sessionManager as never);

    const req = fakeRequest({
      cookies: { podders_session: 'signed' },
      unsignResult: { valid: true, value: 'bad-session' },
    });
    const reply = fakeReply();
    await handler(req, reply as never);

    assert.strictEqual(reply.statusCode, 401);
  });

  it('skips API key check when apiKey config is empty', async () => {
    const sessionManager = { validate: async () => null };
    const pool = mockPool();
    const config = fakeConfig({ apiKey: '' });
    const handler = requireAuth(pool as never, config, sessionManager as never);

    const req = fakeRequest({
      authorization: 'Bearer anything',
      unsignResult: { valid: false, value: null },
    });
    const reply = fakeReply();
    await handler(req, reply as never);

    assert.strictEqual(reply.statusCode, 401);
  });
});

// ===========================================================================
// requireAdmin middleware
// ===========================================================================

describe('requireAdmin', () => {
  it('allows admin users through (no response sent)', () => {
    const req = { user: { discordId: 'u1', username: 'a', role: 'admin' } };
    const reply = fakeReply();
    requireAdmin(req as never, reply as never);

    assert.strictEqual(reply.statusCode, undefined);
  });

  it('returns 403 for viewer role', () => {
    const req = { user: { discordId: 'u1', username: 'a', role: 'viewer' } };
    const reply = fakeReply();
    requireAdmin(req as never, reply as never);

    assert.strictEqual(reply.statusCode, 403);
    assert.deepStrictEqual(reply.body, { error: 'Forbidden: admin access required' });
  });

  it('returns 403 for blocked role', () => {
    const req = { user: { discordId: 'u1', username: 'a', role: 'blocked' } };
    const reply = fakeReply();
    requireAdmin(req as never, reply as never);

    assert.strictEqual(reply.statusCode, 403);
  });

  it('returns 403 when request.user is undefined', () => {
    const req = {};
    const reply = fakeReply();
    requireAdmin(req as never, reply as never);

    assert.strictEqual(reply.statusCode, 403);
  });
});

// ===========================================================================
// normalizeUA — stable OS/browser fingerprint
// ===========================================================================

describe('normalizeUA', () => {
  it('detects Chrome on Mac', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    assert.strictEqual(normalizeUA(ua), 'mac/chrome');
  });

  it('detects Chrome on Mac with different version (same fingerprint)', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
    assert.strictEqual(normalizeUA(ua), 'mac/chrome');
  });

  it('detects Firefox on Linux', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';
    assert.strictEqual(normalizeUA(ua), 'linux/firefox');
  });

  it('detects Edge on Windows (includes chrome in UA string)', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0';
    assert.strictEqual(normalizeUA(ua), 'win/edge');
  });

  it('detects Safari on iOS', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
    assert.strictEqual(normalizeUA(ua), 'ios/safari');
  });

  it('detects Chrome on Android', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
    assert.strictEqual(normalizeUA(ua), 'android/chrome');
  });

  it('returns unknown/unknown for unrecognized UA', () => {
    assert.strictEqual(normalizeUA('curl/7.88.1'), 'unknown/unknown');
  });

  it('returns unknown/unknown for empty string', () => {
    assert.strictEqual(normalizeUA(''), 'unknown/unknown');
  });

  it('detects Opera on Windows', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/110.0.0.0';
    assert.strictEqual(normalizeUA(ua), 'win/opera');
  });

  it('version change does not affect fingerprint', () => {
    const v124 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';
    const v125 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36';
    assert.strictEqual(normalizeUA(v124), normalizeUA(v125));
  });
});

// ===========================================================================
// Session invalidation on empty UA (CL-009)
// ===========================================================================

describe('session invalidation on empty UA', () => {
  it('invalidates session when stored UA exists but request UA is empty', async () => {
    // Create session manager with mock pool that returns a session with a UA
    const pool = mockPool([
      // validate SELECT
      { rows: [{
        discord_id: 'user-1',
        role: 'viewer',
        expires_at: Date.now() + 86400000,
        user_agent: 'Mozilla/5.0 Chrome/124',
        ip_address: '1.2.3.4',
        last_refreshed_at: Date.now(),
      }] },
      // DELETE for invalidation
      { rows: [], rowCount: 1 },
    ]);
    const sm = createSessionManager(pool as never, silentLog);
    const result = await sm.validate('sess-123', '1.2.3.4', '');
    assert.strictEqual(result, null, 'should invalidate when request UA is empty');
  });
});
