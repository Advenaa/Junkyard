import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { StatusProvider } from '../../components/StatusProvider';
import { Settings } from '../Settings';

vi.mock('../../components/AuthProvider', () => {
  const user = {
    discordId: '123456789012345678',
    username: 'pipeline-admin',
    avatar: null,
    role: 'admin' as const,
  };
  const logout = () => {};
  const authValue = { user, loading: false, logout };
  return { useAuth: () => authValue };
});

describe('Settings pipeline status', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('reuses StatusProvider status for Pipeline tab counters without a duplicate /status fetch', async () => {
    let statusCalls = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const requestUrl = new URL(url, 'http://localhost');
        const path = requestUrl.pathname;
        const method = init?.method ?? 'GET';

        if (path === '/api/v1/status' && method === 'GET') {
          statusCalls += 1;
          return new Response(
            JSON.stringify({
              itemsReady: 4,
              itemsProcessing: 1,
              summariesToday: 9,
              costToday: 1.42,
              disabledFeatures: [
                { feature: 'macro', missingEnv: 'FRED_API_KEY', disables: ['macro snapshots'] },
                { feature: 'embeddings', missingEnv: 'GEMINI_API_KEY', disables: ['narrative clustering'] },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (path === '/api/v1/sources' && method === 'GET') {
          return new Response(JSON.stringify({ sources: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/discord/tokens' && method === 'GET') {
          return new Response(JSON.stringify({ tokens: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/discord/tokens/health' && method === 'GET') {
          return new Response(JSON.stringify({ states: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/health' && method === 'GET') {
          return new Response(
            JSON.stringify({
              status: 'ok',
              checks: [{ name: 'db', status: 'ok', message: 'healthy' }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (path === '/api/v1/calendar-events' && method === 'GET') {
          return new Response(JSON.stringify({ events: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/unusual-activity' && method === 'GET') {
          return new Response(JSON.stringify({ latestDate: '2026-04-08', entries: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        throw new Error(`Unhandled fetch ${method} ${path}${requestUrl.search}`);
      }),
    );

    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <StatusProvider>
          <Settings />
        </StatusProvider>
      </MemoryRouter>,
    );

    await screen.findByText('Sources');
    await user.click(screen.getByRole('button', { name: 'Pipeline' }));

    await screen.findByText('Pipeline Status');
    await screen.findByText('System Health');
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('$1.42')).toBeInTheDocument();

    await waitFor(() => {
      expect(statusCalls).toBe(1);
    });
  });
});
