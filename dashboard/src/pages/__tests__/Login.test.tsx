import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { Login } from '../Login';

describe('Login request access flow', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('fetches a CSRF token before posting an access request', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');
      const method = init?.method ?? 'GET';

      if (parsed.pathname === '/api/v1/access-requests/csrf' && method === 'GET') {
        return new Response(JSON.stringify({ csrfToken: 'csrf-token-123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (parsed.pathname === '/api/v1/access-requests' && method === 'POST') {
        const headers =
          init?.headers instanceof Headers
            ? Object.fromEntries(init.headers.entries())
            : (init?.headers as Record<string, string>);
        expect(headers['X-CSRF-Token'] ?? headers['x-csrf-token']).toBe('csrf-token-123');
        expect(JSON.parse(String(init?.body))).toEqual({
          discordId: '123456789012345678',
          requestedRole: 'viewer',
          note: 'Need dashboard access',
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Unhandled fetch ${method} ${parsed.pathname}${parsed.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/login?error=unauthorized']}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Request Access' }));

    const dialog = await screen.findByRole('dialog', { name: 'Request Access' });
    await user.type(within(dialog).getByPlaceholderText('123456789012345678'), '123456789012345678');
    await user.type(within(dialog).getByPlaceholderText('Why do you need access?'), 'Need dashboard access');
    await user.click(within(dialog).getByRole('button', { name: 'Send Request' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText('Access request sent. An admin can review it from Settings > Users.')).toBeInTheDocument();
  });
});
