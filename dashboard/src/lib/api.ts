import type { FeatureDisabledBody, FeatureKey } from './types';

const BASE = '/api/v1';
export const AUTH_EXPIRED_EVENT = 'podders:auth-expired';
export const authRedirect = {
  toLogin() {
    window.location.assign('/login');
  },
};

export class FeatureDisabledError extends Error {
  readonly feature: FeatureKey;
  readonly missingEnv: string;
  readonly disables: string[];

  constructor(body: FeatureDisabledBody) {
    super(`feature_disabled: ${body.feature} (missing ${body.missingEnv})`);
    this.name = 'FeatureDisabledError';
    this.feature = body.feature;
    this.missingEnv = body.missingEnv;
    this.disables = body.disables ?? [];
  }
}

export function isFeatureDisabledError(err: unknown): err is FeatureDisabledError {
  return err instanceof FeatureDisabledError;
}

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
  if (res.status === 503) {
    const parsed = await res
      .clone()
      .json()
      .catch(() => null);
    if (parsed && typeof parsed === 'object' && (parsed as { error?: unknown }).error === 'feature_disabled') {
      throw new FeatureDisabledError(parsed as FeatureDisabledBody);
    }
  }
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}
