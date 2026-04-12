import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { Login } from '../Login';

function renderLogin(initialEntry: string = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<Login />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Login request access flow', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the unauthorized URL-error message when arriving from a rejected auth attempt', () => {
    renderLogin('/login?error=unauthorized');

    expect(screen.getByText("You're not authorized \u2014 ask an admin to invite you")).toBeInTheDocument();
    // Success banner is the "non-empty" path, so the initial render of an
    // error-flagged login must not leak that element.
    expect(
      screen.queryByText('Access request sent. An admin can review it from Settings > Users.'),
    ).not.toBeInTheDocument();
  });

  it('shows the in-flight "Sending..." loading state while the access request POST is pending', async () => {
    let resolveCsrf!: (value: Response) => void;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/access-requests/csrf') {
        // Hold the CSRF fetch open indefinitely so the submit button stays
        // in its disabled "Sending..." loading state until the test
        // explicitly releases it.
        return new Promise<Response>((resolve) => {
          resolveCsrf = resolve;
        });
      }

      throw new Error(`Unhandled fetch ${parsed.pathname}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderLogin();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Request Access' }));

    const dialog = await screen.findByRole('dialog', { name: 'Request Access' });
    await user.type(within(dialog).getByPlaceholderText('123456789012345678'), '123456789012345678');
    await user.click(within(dialog).getByRole('button', { name: 'Send Request' }));

    const sendingButton = await within(dialog).findByRole('button', { name: 'Sending...' });
    expect(sendingButton).toBeDisabled();
    // While the request is loading the dialog must remain mounted — no
    // premature success banner, no premature error banner.
    expect(
      screen.queryByText('Access request sent. An admin can review it from Settings > Users.'),
    ).not.toBeInTheDocument();

    // Drain the deferred fetch so test cleanup doesn't leave a dangling
    // promise in the next test's setup.
    await act(async () => {
      resolveCsrf(
        new Response(JSON.stringify({ csrfToken: 'csrf-drain' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
  });

  it('surfaces the 429 rate-limit error message when the access request POST is throttled', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');
      const method = init?.method ?? 'GET';

      if (parsed.pathname === '/api/v1/access-requests/csrf' && method === 'GET') {
        return new Response(JSON.stringify({ csrfToken: 'csrf-token-429' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (parsed.pathname === '/api/v1/access-requests' && method === 'POST') {
        return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
          status: 429,
          statusText: 'Too Many Requests',
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Unhandled fetch ${method} ${parsed.pathname}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderLogin();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Request Access' }));

    const dialog = await screen.findByRole('dialog', { name: 'Request Access' });
    await user.type(within(dialog).getByPlaceholderText('123456789012345678'), '123456789012345678');
    await user.click(within(dialog).getByRole('button', { name: 'Send Request' }));

    await within(dialog).findByText('Too many requests from this network. Please try again later.');
    // The dialog must stay open on error so the user can retry.
    expect(screen.getByRole('dialog', { name: 'Request Access' })).toBeInTheDocument();
    // And no success banner leaked through.
    expect(
      screen.queryByText('Access request sent. An admin can review it from Settings > Users.'),
    ).not.toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: 'Request Access' }));

    const reopenedDialog = await screen.findByRole('dialog', { name: 'Request Access' });
    expect(within(reopenedDialog).getByPlaceholderText('123456789012345678')).toHaveValue('');
    expect(within(reopenedDialog).getByRole('combobox')).toHaveValue('viewer');
    expect(within(reopenedDialog).getByPlaceholderText('Why do you need access?')).toHaveValue('');
    expect(
      screen.queryByText('Access request sent. An admin can review it from Settings > Users.'),
    ).not.toBeInTheDocument();
  });
});
