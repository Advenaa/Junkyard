export type DiscordTokenSource = 'env' | 'db';

export interface DiscordRuntimeToken {
  token: string;
  source: DiscordTokenSource;
  tokenId: string | null;
  label: string | null;
  maskedToken: string;
  proxyUrl: string | null;
  maskedProxy: string | null;
}

export function maskDiscordToken(token: string): string {
  if (token.length <= 14) {
    return token.length > 8 ? token.slice(0, 4) + '...' + token.slice(-4) : token;
  }
  return token.slice(0, 10) + '...' + token.slice(-4);
}

export function normalizeProxyUrl(rawProxyUrl: string): string {
  const trimmed = rawProxyUrl.trim();
  if (!trimmed) {
    throw new Error('Proxy URL is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Proxy URL must be a valid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Proxy URL must use http:// or https://');
  }

  if (!parsed.hostname) {
    throw new Error('Proxy URL must include a host');
  }

  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw new Error('Proxy URL must not include a path, query, or hash');
  }

  return parsed.toString();
}

export function maskProxyUrl(proxyUrl: string): string {
  try {
    const parsed = new URL(proxyUrl);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
  } catch {
    return '[invalid proxy]';
  }
}

export function createEnvDiscordTokens(envTokens: string[]): DiscordRuntimeToken[] {
  const runtimeTokens: DiscordRuntimeToken[] = [];
  const seen = new Set<string>();

  for (const token of envTokens.map((value) => value.trim()).filter(Boolean)) {
    if (seen.has(token)) continue;
    seen.add(token);
    runtimeTokens.push({
      token,
      source: 'env',
      tokenId: null,
      label: null,
      maskedToken: maskDiscordToken(token),
      proxyUrl: null,
      maskedProxy: null,
    });
  }

  return runtimeTokens;
}
