import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, AUTH_EXPIRED_EVENT, authRedirect } from '../api';

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

  it('wraps non-ok JSON responses in an ApiError with status, statusText, and detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Invalid webhook URL', detail: 'private IPs blocked' }), {
          status: 400,
          statusText: 'Bad Request',
          headers: new Headers({ 'content-type': 'application/json' }),
        }),
      ),
    );

    await expect(apiFetch('/config/test-webhook', { method: 'POST' })).rejects.toThrow('API 400');

    try {
      await apiFetch('/config/test-webhook', { method: 'POST' });
      throw new Error('expected apiFetch to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({
        status: 400,
        statusText: 'Bad Request',
        detail: 'private IPs blocked',
      });
    }
  });

  it('falls back to null detail when the response body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>server error</html>', {
          status: 500,
          statusText: 'Internal Server Error',
          headers: new Headers({ 'content-type': 'text/html' }),
        }),
      ),
    );

    try {
      await apiFetch('/config/test-webhook', { method: 'POST' });
      throw new Error('expected apiFetch to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({
        status: 500,
        statusText: 'Internal Server Error',
        detail: null,
      });
      expect((err as ApiError).message).toBe('API 500: Internal Server Error');
    }
  });
});
