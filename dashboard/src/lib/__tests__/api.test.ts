import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, AUTH_EXPIRED_EVENT, authRedirect } from '../api';

describe('apiFetch', () => {
  function mockLocationAssign() {
    return vi.spyOn(authRedirect, 'toLogin').mockImplementation(() => {
      window.history.replaceState({}, '', '/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
  });

  it('returns undefined for 204 responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        headers: new Headers(),
        json: vi.fn(),
      }),
    );

    await expect(apiFetch<void>('/tokens', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('rejects 401 responses and broadcasts auth expiry outside the login route', async () => {
    const onAuthExpired = vi.fn();
    const assignSpy = mockLocationAssign();
    window.history.replaceState({}, '', '/reports');
    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers(),
        json: vi.fn(),
      }),
    );

    await expect(apiFetch('/reports')).rejects.toThrow('API 401: Unauthorized');
    expect(onAuthExpired).toHaveBeenCalledTimes(1);
    expect(assignSpy).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/login');

    window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
  });

  it('does not broadcast auth expiry when 401 happens on the login route', async () => {
    const onAuthExpired = vi.fn();
    window.history.replaceState({}, '', '/login');
    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers(),
        json: vi.fn(),
      }),
    );

    await expect(apiFetch('/auth/me')).rejects.toThrow('API 401: Unauthorized');
    expect(onAuthExpired).not.toHaveBeenCalled();

    window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
  });
});
