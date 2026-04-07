const BASE = '/api/v1';

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
  if (res.status === 401 && window.location.pathname !== '/login') {
    window.location.href = '/login';
    return new Promise(() => {}) as Promise<T>;
  }
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}
