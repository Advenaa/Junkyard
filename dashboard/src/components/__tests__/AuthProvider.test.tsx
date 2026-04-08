import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from '../AuthProvider';
import { ProtectedRoute } from '../ProtectedRoute';
import { AUTH_EXPIRED_EVENT, authRedirect } from '../../lib/api';

function AuthProbe() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div>loading</div>;
  }

  return <div>{user?.username ?? 'guest'}</div>;
}

function mockLocationAssign() {
  return vi.spyOn(authRedirect, 'toLogin').mockImplementation(() => {
    window.history.replaceState({}, '', '/login');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

describe('AuthProvider', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
  });

  it('clears the current user when auth expiry is broadcast', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ discordId: 'user-1', username: 'ardi', avatar: null, role: 'viewer' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await screen.findByText('ardi');

    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));

    await waitFor(() => {
      expect(screen.getByText('guest')).toBeInTheDocument();
    });
    expect(window.location.pathname).toBe('/login');
  });

  it('navigates initial 401 auth checks to the login route instead of hanging on loading', async () => {
    window.history.replaceState({}, '', '/');
    const assignSpy = mockLocationAssign();
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

    render(
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<div>login page</div>} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<div>home page</div>} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('login page')).toBeInTheDocument();
    });
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(assignSpy).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/login');
  });

  it('navigates focus-triggered 401 revalidation back to the login route', async () => {
    window.history.replaceState({}, '', '/');
    const assignSpy = mockLocationAssign();
    let authCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        authCalls += 1;
        if (authCalls === 1) {
          return new Response(JSON.stringify({ discordId: 'user-1', username: 'ardi', avatar: null, role: 'viewer' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          statusText: 'Unauthorized',
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    render(
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<div>login page</div>} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<div>home page</div>} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>,
    );

    await screen.findByText('home page');
    window.dispatchEvent(new Event('focus'));

    await waitFor(() => {
      expect(screen.getByText('login page')).toBeInTheDocument();
    });
    expect(assignSpy).toHaveBeenCalledTimes(2);
    expect(window.location.pathname).toBe('/login');
  });
});
