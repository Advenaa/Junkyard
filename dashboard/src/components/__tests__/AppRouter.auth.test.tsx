import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { AppRouter } from '../../router';
import { authRedirect } from '../../lib/api';

function mockAuthRedirect() {
  return vi.spyOn(authRedirect, 'toLogin').mockImplementation(() => {
    window.history.replaceState({}, '', '/login');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

describe('AppRouter auth expiry flow', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
  });

  it('redirects the real dashboard shell to the login route on an initial /auth/me 401', async () => {
    window.history.replaceState({}, '', '/');
    const redirectSpy = mockAuthRedirect();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          statusText: 'Unauthorized',
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    render(<AppRouter />);

    await waitFor(() => {
      expect(screen.getByText('Sign in with Discord')).toBeInTheDocument();
    });
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(redirectSpy).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/login');
  });

  it('redirects the real dashboard shell to login when focus revalidation hits a 401', async () => {
    window.history.replaceState({}, '', '/');
    const redirectSpy = mockAuthRedirect();
    let authCalls = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const requestUrl = new URL(url, 'http://localhost');
        const path = requestUrl.pathname;

        if (path === '/api/v1/auth/me') {
          authCalls += 1;
          if (authCalls === 1) {
            return new Response(
              JSON.stringify({
                discordId: '123456789012345678',
                username: 'ardi',
                avatar: null,
                role: 'viewer',
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          }

          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            statusText: 'Unauthorized',
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/reports') {
          return new Response(JSON.stringify({ reports: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/macro') {
          return new Response(JSON.stringify({ error: 'No macro data available yet' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/narratives') {
          return new Response(JSON.stringify({ latestDate: null, entries: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/unusual-activity') {
          return new Response(JSON.stringify({ latestDate: null, entries: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/first-movers') {
          return new Response(JSON.stringify({ latestTimestamp: null, entries: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/calendar-events') {
          return new Response(JSON.stringify({ events: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        throw new Error(`Unhandled fetch ${path}${requestUrl.search}`);
      }),
    );

    render(<AppRouter />);

    await screen.findByText('No reports yet');
    window.dispatchEvent(new Event('focus'));

    await waitFor(() => {
      expect(screen.getByText('Sign in with Discord')).toBeInTheDocument();
    });
    expect(redirectSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(window.location.pathname).toBe('/login');
  });
});
