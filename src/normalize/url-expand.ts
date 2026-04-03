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
  /** Best HTTPS URL seen so far — only updated on validated HTTPS hops */
  let lastHttps = url;
  let pinnedFetchUrl: string | undefined;
  let pinnedHost: string | undefined;
  let consecutiveHttpHops = 0;

  try {
    // Quick validation — will throw on invalid URLs
    const parsed = new URL(current);
    if (parsed.protocol === 'https:') lastHttps = current;
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
      if (!location) return lastHttps;

      // Resolve relative redirects against the current URL
      const resolved = new URL(location, current);

      // Only follow HTTP and HTTPS redirects — reject other protocols
      if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') {
        return lastHttps;
      }

      // SSRF check — reject private IPs and non-standard ports
      const validation = await validateUrl(resolved.href);
      if (!validation.valid) return lastHttps;

      current = resolved.href;

      if (resolved.protocol === 'https:') {
        lastHttps = current;
        consecutiveHttpHops = 0;

        // Pin next fetch to the validated IP to close the TOCTOU window
        if (validation.resolvedIp) {
          const pinned = new URL(current);
          pinnedHost = pinned.hostname;
          pinned.hostname = net.isIPv6(validation.resolvedIp)
            ? `[${validation.resolvedIp}]`
            : validation.resolvedIp;
          pinnedFetchUrl = pinned.href;
        }
      } else {
        // HTTP hop — follow it to see if next hop upgrades to HTTPS
        consecutiveHttpHops++;
        // Two consecutive HTTP hops means this chain won't upgrade — bail out
        if (consecutiveHttpHops >= 2) return lastHttps;

        // Pin HTTP hops too for TOCTOU safety
        if (validation.resolvedIp) {
          const pinned = new URL(current);
          pinnedHost = pinned.hostname;
          pinned.hostname = net.isIPv6(validation.resolvedIp)
            ? `[${validation.resolvedIp}]`
            : validation.resolvedIp;
          pinnedFetchUrl = pinned.href;
        }
      }
    } catch {
      return lastHttps;
    }
  }

  return lastHttps;
}
