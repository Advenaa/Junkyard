import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Settings } from '../Settings';

vi.mock('../../components/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      discordId: '123456789012345678',
      username: 'proxy-admin',
      avatar: null,
      role: 'admin' as const,
    },
    loading: false,
    logout: vi.fn(),
  }),
}));
vi.mock('../../components/StatusProvider', () => {
  const statusValue = {
    ready: true,
    status: null,
    disabledFeatures: [],
    isFeatureDisabled: () => false,
    getDisabledFeature: () => null,
    registerDisabledFeature: vi.fn(),
  };
  return { useStatus: () => statusValue };
});

interface MockToken {
  id: string;
  maskedToken: string;
  label: string | null;
  status: 'active' | 'disabled';
  addedAt: number;
  lastUsedAt: number | null;
  proxyConfigured: boolean;
  maskedProxy: string | null;
}

interface MockHealthState {
  index: number;
  status: 'active' | 'idle' | 'disabled';
  errorCount: number;
  lastSuccessfulPollAt: number | null;
  channelCount: number;
  source: 'env' | 'db';
  tokenId: string | null;
  label: string | null;
  maskedToken: string | null;
  proxyConfigured: boolean;
  maskedProxy: string | null;
}

function maskToken(token: string): string {
  if (token.length <= 14) {
    return token.length > 8 ? token.slice(0, 4) + '...' + token.slice(-4) : token;
  }
  return token.slice(0, 10) + '...' + token.slice(-4);
}

function maskProxy(proxyUrl: string): string {
  const parsed = new URL(proxyUrl);
  return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
}

describe('Settings proxy management', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lets admins add, update, and clear per-token proxies', async () => {
    const tokens: MockToken[] = [];
    const health: MockHealthState[] = [];

    function syncHealth(token: MockToken): void {
      const next: MockHealthState = {
        index: 0,
        status: token.status === 'disabled' ? 'disabled' : 'active',
        errorCount: 0,
        lastSuccessfulPollAt: Date.now() - 120_000,
        channelCount: token.status === 'disabled' ? 0 : 4,
        source: 'db',
        tokenId: token.id,
        label: token.label,
        maskedToken: token.maskedToken,
        proxyConfigured: token.proxyConfigured,
        maskedProxy: token.maskedProxy,
      };
      if (health.length === 0) {
        health.push(next);
      } else {
        health[0] = next;
      }
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const path = new URL(url, 'http://localhost').pathname;
        const method = init?.method ?? 'GET';

        if (path === '/api/v1/sources' && method === 'GET') {
          return new Response(JSON.stringify({ sources: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/discord/tokens' && method === 'GET') {
          return new Response(JSON.stringify({ tokens }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/discord/tokens/health' && method === 'GET') {
          return new Response(JSON.stringify({ states: health }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/status' && method === 'GET') {
          return new Response(
            JSON.stringify({ itemsReady: 4, itemsProcessing: 1, summariesToday: 9, costToday: 1.42 }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        if (path === '/api/v1/health' && method === 'GET') {
          return new Response(JSON.stringify({ status: 'ok', checks: { db: 'ok', ingest: 'ok' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/config' && method === 'GET') {
          return new Response(JSON.stringify({ digestTime: '09:00', timezone: 'Asia/Jakarta', webhookUrl: '' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/calendar-events' && method === 'GET') {
          return new Response(JSON.stringify({ events: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/macro' && method === 'GET') {
          return new Response(JSON.stringify({ error: 'No macro data available yet' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/unusual-activity' && method === 'GET') {
          return new Response(JSON.stringify({ latestDate: '2026-04-08', entries: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/narratives' && method === 'GET') {
          return new Response(JSON.stringify({ latestDate: '2026-04-08', entries: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/discord/tokens' && method === 'POST') {
          const payload = JSON.parse(String(init?.body ?? '{}')) as {
            token: string;
            label?: string;
            proxyUrl?: string;
          };
          const token: MockToken = {
            id: `tok-${tokens.length + 1}`,
            maskedToken: maskToken(payload.token),
            label: payload.label ?? null,
            status: 'active',
            addedAt: Date.now(),
            lastUsedAt: Date.now() - 30_000,
            proxyConfigured: Boolean(payload.proxyUrl),
            maskedProxy: payload.proxyUrl ? maskProxy(payload.proxyUrl) : null,
          };
          tokens.unshift(token);
          syncHealth(token);
          return new Response(JSON.stringify(token), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path.startsWith('/api/v1/discord/tokens/') && method === 'PATCH') {
          const tokenId = path.split('/').pop();
          const payload = JSON.parse(String(init?.body ?? '{}')) as {
            label?: string;
            status?: 'active' | 'disabled';
            proxyUrl?: string | null;
          };
          const token = tokens.find((entry) => entry.id === tokenId);
          if (!token) {
            return new Response(JSON.stringify({ error: 'Token not found' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          if (payload.label !== undefined) token.label = payload.label;
          if (payload.status !== undefined) token.status = payload.status;
          if (Object.prototype.hasOwnProperty.call(payload, 'proxyUrl')) {
            token.proxyConfigured = payload.proxyUrl != null;
            token.maskedProxy = payload.proxyUrl ? maskProxy(payload.proxyUrl) : null;
          }
          syncHealth(token);

          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        throw new Error(`Unhandled fetch ${method} ${path}`);
      }),
    );

    const user = userEvent.setup();
    render(<Settings />);

    await screen.findByText('Managed Discord Tokens');

    await user.click(screen.getByRole('button', { name: 'Add Token' }));

    const addDialog = await screen.findByRole('dialog', { name: 'Add Discord Token' });
    await user.type(within(addDialog).getByPlaceholderText('Optional label (e.g. Backup account)'), 'Proxy Scout');
    await user.type(
      within(addDialog).getByPlaceholderText('Paste the raw Discord user token'),
      'mfa.this-is-a-demo-token-1234567890',
    );
    await user.type(
      within(addDialog).getByPlaceholderText('Optional http://user:pass@proxy.example:8080'),
      'http://user:pass@proxy.one.example:8080',
    );
    await user.click(within(addDialog).getByRole('button', { name: 'Add Token' }));

    const tokenCell = (await screen.findAllByText('Proxy Scout')).find((element) => element.closest('tr')) ?? null;
    const tokenRow = tokenCell?.closest('tr') ?? null;
    expect(tokenRow).not.toBeNull();
    expect(within(tokenRow!).getByText('http://proxy.one.example:8080')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText('http://proxy.one.example:8080').length).toBeGreaterThanOrEqual(2);
    });

    await user.click(within(tokenRow!).getByRole('button', { name: 'Proxy' }));

    const proxyDialog = await screen.findByRole('dialog', { name: 'Configure Token Proxy' });
    const proxyInput = within(proxyDialog).getByPlaceholderText('http://user:pass@proxy.example:8080');
    await user.clear(proxyInput);
    await user.type(proxyInput, 'http://user:pass@proxy.two.example:9090');
    await user.click(within(proxyDialog).getByRole('button', { name: 'Save Proxy' }));

    await waitFor(() => {
      expect(screen.getAllByText('http://proxy.two.example:9090').length).toBeGreaterThanOrEqual(2);
    });

    const updatedCell = screen.getAllByText('Proxy Scout').find((element) => element.closest('tr')) ?? null;
    const updatedRow = updatedCell?.closest('tr') ?? null;
    expect(updatedRow).not.toBeNull();

    await user.click(within(updatedRow!).getByRole('button', { name: 'Proxy' }));
    const clearDialog = await screen.findByRole('dialog', { name: 'Configure Token Proxy' });
    await user.click(within(clearDialog).getByRole('button', { name: 'Clear Proxy' }));

    await waitFor(() => {
      const finalCell = screen.getAllByText('Proxy Scout').find((element) => element.closest('tr')) ?? null;
      expect(finalCell).not.toBeNull();
      expect(within(finalCell!.closest('tr')!).getByText('Direct')).toBeInTheDocument();
      expect(screen.getAllByText('Direct').length).toBeGreaterThanOrEqual(2);
    });
  });
});
