import type { FeatureDisabledBody, FeatureDisabledReason, FeatureKey } from './types';

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
  readonly reason?: FeatureDisabledReason;

  constructor(body: FeatureDisabledBody) {
    super(`feature_disabled: ${body.feature} (missing ${body.missingEnv})`);
    this.name = 'FeatureDisabledError';
    this.feature = body.feature;
    this.missingEnv = body.missingEnv;
    this.disables = body.disables ?? [];
    this.reason = body.reason;
  }
}

export function isFeatureDisabledError(err: unknown): err is FeatureDisabledError {
  return err instanceof FeatureDisabledError;
}

export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly detail: string | null;

  constructor(status: number, statusText: string, detail: string | null) {
    const base = `API ${status}: ${statusText}`;
    super(detail ? `${base} — ${detail}` : base);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.detail = detail;
  }
}

export class RateLimitError extends ApiError {
  readonly retryAfter: number | null;

  constructor(statusText: string, detail: string | null, retryAfter: number | null) {
    super(429, statusText, detail);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class AuthExpiredError extends ApiError {
  constructor(statusText: string, detail: string | null) {
    super(401, statusText, detail);
    this.name = 'AuthExpiredError';
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export function isRateLimitError(err: unknown): err is RateLimitError {
  return err instanceof RateLimitError;
}

export function isAuthExpiredError(err: unknown): err is AuthExpiredError {
  return err instanceof AuthExpiredError;
}

async function extractErrorDetail(res: Response): Promise<string | null> {
  try {
    const parsed = (await res.clone().json()) as unknown;
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as { detail?: unknown; error?: unknown };
      if (typeof obj.detail === 'string' && obj.detail.length > 0) return obj.detail;
      if (typeof obj.error === 'string' && obj.error.length > 0) return obj.error;
    }
  } catch {
    // Fall through when the error body is not JSON.
  }
  return null;
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
    const detail = await extractErrorDetail(res);
    throw new AuthExpiredError(res.statusText, detail);
  }
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    const detail = await extractErrorDetail(res);
    throw new RateLimitError(res.statusText, detail, retryAfter ? Number(retryAfter) : null);
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
  if (!res.ok) {
    const detail = await extractErrorDetail(res);
    throw new ApiError(res.status, res.statusText, detail);
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}
