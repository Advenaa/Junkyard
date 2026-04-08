const BASE = '/api/v1';
export const AUTH_EXPIRED_EVENT = 'podders:auth-expired';
export const authRedirect = {
  toLogin() {
    window.location.assign('/login');
  },
};

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const { headers: extraHeaders, body, ...rest } = options ?? {};
  const headers: Record<string, string> = { ...(extraHeaders as Record<string, string>) };
  if (body != null) {
    headers['Content-Type'] ??= 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers,
    body,
    ...rest,
  });
  if (res.status === 401) {
    if (window.location.pathname !== '/login') {
      window.history.replaceState({}, '', '/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
      authRedirect.toLogin();
    }
    throw new Error(`API ${res.status}: ${res.statusText}`);
  }
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}
