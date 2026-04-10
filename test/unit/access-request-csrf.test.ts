import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../src/server.js';
import type { Config } from '../../src/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    anthropicApiKey: '',
    openaiApiKey: '',
    googleApiKey: '',
    geminiApiKey: '',
    databaseUrl: 'postgresql://podders:test@localhost:5432/podders',
    discordClientId: null,
    discordClientSecret: null,
    adminUserIds: [],
    discordTokens: [],
    twitterApiKey: null,
    coingeckoApiKey: null,
    fredApiKey: null,
    apiKey: 'test-api-key',
    sessionSecret: 'test-session-secret',
    port: 3000,
    dataDir: './data',
    publicUrl: 'https://podders.test',
    alertWebhookUrl: null,
    models: {
      haiku: 'haiku',
      sonnet: 'sonnet',
    },
    secrets: [],
    ...overrides,
  };
}

function createPool() {
  const rows = new Map<string, Record<string, unknown>>();
  const calls: Array<{ text: string; values: unknown[] }> = [];

  return {
    calls,
    async query(text: string, values?: unknown[]) {
      const params = values ?? [];
      calls.push({ text, values: params });

      if (text.includes('SELECT * FROM access_requests WHERE discord_id = $1')) {
        const [discordId] = params as [string];
        const pending = [...rows.values()].find((row) => row.discord_id === discordId && row.status === 'pending');
        return { rows: pending ? [pending] : [], rowCount: pending ? 1 : 0 };
      }

      if (text.includes('UPDATE access_requests')) {
        const [id, requestedRole, note, createdAt] = params as [string, 'viewer' | 'admin', string | null, number];
        const existing = rows.get(id);
        assert.ok(existing, 'existing access request should exist before update');
        const updated = {
          ...existing,
          requested_role: requestedRole,
          note,
          created_at: createdAt,
        };
        rows.set(id, updated);
        return { rows: [updated], rowCount: 1 };
      }

      if (text.includes('INSERT INTO access_requests')) {
        const [id, discordId, requestedRole, note, createdAt] = params as [
          string,
          string,
          'viewer' | 'admin',
          string | null,
          number,
        ];
        const row = {
          id,
          discord_id: discordId,
          requested_role: requestedRole,
          note,
          status: 'pending',
          resolved_role: null,
          decided_at: null,
          decided_by_discord_id: null,
          created_at: createdAt,
        };
        rows.set(id, row);
        return { rows: [row], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

const log = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return log;
  },
} as never;

const healthMonitor = {
  async getStatus() {
    return { checks: {}, healthy: true };
  },
} as never;

function extractCookie(response: { headers: Record<string, string | string[] | undefined> }): string {
  const raw = response.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  assert.ok(header, 'response should set a CSRF cookie');
  return header.split(';', 1)[0]!;
}

describe('access request CSRF protection', () => {
  it('issues a CSRF token response and signed cookie for the login form', async () => {
    const app = await createServer(createConfig(), createPool() as never, log, healthMonitor);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/access-requests/csrf',
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['cache-control'], 'no-store');
      const body = JSON.parse(response.payload) as { csrfToken: string };
      assert.match(body.csrfToken, /^[0-9a-f]{64}$/);
      assert.match(extractCookie(response), /^podders_access_request_csrf=/);
    } finally {
      await app.close();
    }
  });

  it('rejects access request submissions without a valid CSRF token before any insert', async () => {
    const pool = createPool();
    const app = await createServer(createConfig(), pool as never, log, healthMonitor);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/access-requests',
        payload: {
          discordId: '123456789012345678',
          requestedRole: 'viewer',
        },
      });

      assert.equal(response.statusCode, 403);
      assert.deepStrictEqual(JSON.parse(response.payload), { error: 'Invalid CSRF token' });
      assert.equal(
        pool.calls.some((call) => call.text.includes('INSERT INTO access_requests')),
        false,
        'route should reject before any insert happens',
      );
    } finally {
      await app.close();
    }
  });

  it('accepts access request submissions with the fetched CSRF token and cookie', async () => {
    const pool = createPool();
    const app = await createServer(createConfig(), pool as never, log, healthMonitor);

    try {
      const csrfResponse = await app.inject({
        method: 'GET',
        url: '/api/v1/access-requests/csrf',
      });
      const { csrfToken } = JSON.parse(csrfResponse.payload) as { csrfToken: string };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/access-requests',
        headers: {
          cookie: extractCookie(csrfResponse),
          'x-csrf-token': csrfToken,
        },
        payload: {
          discordId: '123456789012345678',
          requestedRole: 'viewer',
          note: 'Please add me.',
        },
      });

      assert.equal(response.statusCode, 201);
      const body = JSON.parse(response.payload) as {
        discordId: string;
        requestedRole: string;
        note: string | null;
        status: string;
      };
      assert.equal(body.discordId, '123456789012345678');
      assert.equal(body.requestedRole, 'viewer');
      assert.equal(body.note, 'Please add me.');
      assert.equal(body.status, 'pending');
    } finally {
      await app.close();
    }
  });
});

describe('Login access request flow', () => {
  const src = readSrc('dashboard/src/pages/Login.tsx');

  it('fetches a CSRF token before posting an access request', () => {
    assert.ok(src.includes('/access-requests/csrf'), 'Login request form should fetch a CSRF token before submit');
  });

  it('sends the CSRF token in a dedicated request header', () => {
    assert.ok(
      src.includes('X-CSRF-Token'),
      'Login request form should send the fetched CSRF token in a dedicated header',
    );
  });
});
