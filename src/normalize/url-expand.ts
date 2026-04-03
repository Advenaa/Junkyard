import net from 'node:net';
import { validateUrl } from '../url-validator.js';

const SHORT_HOSTS = new Set([
  't.co',
  'bit.ly',
  'goo.gl',
  'tinyurl.com',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'adf.ly',
  'j.mp',
]);

const MAX_REDIRECTS = 5;

export function isShortUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return SHORT_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

export async function expandUrl(url: string): Promise<string> {
  let current = url;
  let pinnedFetchUrl: string | undefined;
  let pinnedHost: string | undefined;

  try {
    // Quick validation — will throw on invalid URLs
    new URL(current);
  } catch {
    return url;
  }

  for (let i = 0; i < MAX_REDIRECTS; i++) {
    try {
      const fetchHeaders: Record<string, string> = {};
      let fetchTarget = current;

      // Use DNS-pinned URL if available from previous hop's validation
      if (pinnedFetchUrl && pinnedHost) {
        fetchTarget = pinnedFetchUrl;
        fetchHeaders['Host'] = pinnedHost;
      }

      const response = await fetch(fetchTarget, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
        headers: fetchHeaders,
      });

      // Reset pinning — will be set again if we follow another redirect
      pinnedFetchUrl = undefined;
      pinnedHost = undefined;

      const location = response.headers.get('location');
      if (!location) return current;

      // Resolve relative redirects against the current URL
      const resolved = new URL(location, current);

      // Only follow HTTPS redirects
      if (resolved.protocol !== 'https:') return current;

      // SSRF check — reject private IPs and non-standard ports
      const validation = await validateUrl(resolved.href);
      if (!validation.valid) return current;

      current = resolved.href;

      // Pin next fetch to the validated IP to close the TOCTOU window
      if (validation.resolvedIp) {
        const pinned = new URL(current);
        pinnedHost = pinned.hostname;
        pinned.hostname = net.isIPv6(validation.resolvedIp)
          ? `[${validation.resolvedIp}]`
          : validation.resolvedIp;
        pinnedFetchUrl = pinned.href;
      }
    } catch {
      return current;
    }
  }

  return current;
}
