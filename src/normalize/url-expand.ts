import dns from 'node:dns';
import net from 'node:net';
import { validateUrl } from '../url-validator.js';

const SHORT_HOSTS = new Set(['t.co', 'bit.ly', 'goo.gl', 'tinyurl.com', 'ow.ly', 'is.gd', 'buff.ly', 'adf.ly', 'j.mp']);

const MAX_REDIRECTS = 5;

/**
 * Lightweight SSRF validation for intermediate redirect hops.
 *
 * Unlike the full `validateUrl()`, this allows HTTP (not just HTTPS) since
 * many shorteners redirect through HTTP before landing on HTTPS. It still
 * enforces all other SSRF protections: standard ports, no localhost, no
 * private IPs.
 *
 * The FINAL resolved URL must always go through the full `validateUrl()`.
 */
async function validateIntermediateHop(parsed: URL): Promise<{ valid: boolean; resolvedIp?: string }> {
  // Reject non-standard ports (allow 80 for HTTP, 443 for HTTPS, or default)
  if (parsed.port !== '') {
    const portNum = Number(parsed.port);
    if (portNum !== 80 && portNum !== 443) {
      return { valid: false };
    }
  }

  // Reject localhost and .local
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  ) {
    return { valid: false };
  }

  // Block literal IP hostnames that resolve to private ranges
  const literalHost =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, hostname.length - 1) : hostname;
  if (net.isIP(literalHost)) {
    if (net.isIPv4(literalHost)) {
      const parts = literalHost.split('.').map(Number);
      const [a, b] = parts;
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254)
      ) {
        return { valid: false };
      }
    } else if (net.isIPv6(literalHost)) {
      const normalized = literalHost.toLowerCase();
      if (
        normalized === '::1' ||
        normalized === '::' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        normalized.startsWith('fe80')
      ) {
        return { valid: false };
      }
    }
    return { valid: true, resolvedIp: literalHost };
  }

  // DNS resolve — reject private IPs
  const [ipv4Result, ipv6Result] = await Promise.allSettled([
    dns.promises.resolve4(hostname),
    dns.promises.resolve6(hostname),
  ]);

  const allIps: string[] = [];
  if (ipv4Result.status === 'fulfilled') allIps.push(...ipv4Result.value);
  if (ipv6Result.status === 'fulfilled') allIps.push(...ipv6Result.value);

  for (const ip of allIps) {
    if (net.isIPv4(ip)) {
      const parts = ip.split('.').map(Number);
      const [a, b] = parts;
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254)
      ) {
        return { valid: false };
      }
    } else if (net.isIPv6(ip)) {
      const normalized = ip.toLowerCase();
      if (
        normalized === '::1' ||
        normalized === '::' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        normalized.startsWith('fe80')
      ) {
        return { valid: false };
      }
    }
  }

  return { valid: true, resolvedIp: allIps[0] };
}

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

      if (resolved.protocol === 'https:') {
        // Full SSRF validation for HTTPS hops (includes protocol check)
        const validation = await validateUrl(resolved.href);
        if (!validation.valid) return lastHttps;

        current = resolved.href;
        lastHttps = current;
        consecutiveHttpHops = 0;

        // Pin next fetch to the validated IP to close the TOCTOU window
        if (validation.resolvedIp) {
          const pinned = new URL(current);
          pinnedHost = pinned.hostname;
          pinned.hostname = net.isIPv6(validation.resolvedIp) ? `[${validation.resolvedIp}]` : validation.resolvedIp;
          pinnedFetchUrl = pinned.href;
        }
      } else {
        // HTTP intermediate hop — use lightweight SSRF check (no HTTPS requirement)
        // since many shorteners redirect http→https across hops
        const hopCheck = await validateIntermediateHop(resolved);
        if (!hopCheck.valid) return lastHttps;

        current = resolved.href;
        consecutiveHttpHops++;
        // Two consecutive HTTP hops means this chain won't upgrade — bail out
        if (consecutiveHttpHops >= 2) return lastHttps;

        // Pin HTTP hops too for TOCTOU safety
        if (hopCheck.resolvedIp) {
          const pinned = new URL(current);
          pinnedHost = pinned.hostname;
          pinned.hostname = net.isIPv6(hopCheck.resolvedIp) ? `[${hopCheck.resolvedIp}]` : hopCheck.resolvedIp;
          pinnedFetchUrl = pinned.href;
        }
      }
    } catch {
      return lastHttps;
    }
  }

  return lastHttps;
}
