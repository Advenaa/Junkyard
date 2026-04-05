import dns from 'node:dns';
import net from 'node:net';

/**
 * Compress an IPv6 address string to its canonical shortest form.
 * E.g. "0000:0000:0000:0000:0000:0000:0000:0001" → "::1"
 */
function canonicalizeIPv6(ip: string): string {
  // Expand :: into full zero groups
  let groups: string[];
  if (ip.includes('::')) {
    const [left, right] = ip.split('::');
    const leftGroups = left ? left.split(':') : [];
    const rightGroups = right ? right.split(':') : [];
    const missing = 8 - leftGroups.length - rightGroups.length;
    const zeroFill = Array.from<string>({ length: missing }).fill('0');
    groups = [...leftGroups, ...zeroFill, ...rightGroups];
  } else {
    groups = ip.split(':');
  }

  // Normalize each group: strip leading zeros
  const normalized = groups.map((g) => {
    const stripped = g.replace(/^0+/, '') || '0';
    return stripped;
  });

  // Find longest run of consecutive '0' groups for :: compression
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;

  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === '0') {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }

  if (bestLen >= 2) {
    const before = normalized.slice(0, bestStart);
    const after = normalized.slice(bestStart + bestLen);
    return (before.length > 0 ? before.join(':') : '') + '::' + (after.length > 0 ? after.join(':') : '');
  }

  return normalized.join(':');
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;

    // 0.0.0.0/8
    if (a === 0) return true;
    // 10.0.0.0/8
    if (a === 10) return true;
    // 127.0.0.0/8
    if (a === 127) return true;
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    // 169.254.0.0/16 (link-local)
    if (a === 169 && b === 254) return true;

    return false;
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();

    // Check for IPv4-mapped IPv6 addresses (::ffff:x.x.x.x)
    // These encode an IPv4 address inside IPv6 — extract and check the IPv4 part.
    const v4MappedMatch = normalized.match(/^(?:0{0,4}:){0,4}(?:0{0,4}:)?ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (v4MappedMatch) {
      return isPrivateIp(v4MappedMatch[1]);
    }

    // Normalize expanded IPv6 to compressed form for reliable comparison.
    // Expand all groups to full 8-group representation, then compress.
    const canonical = canonicalizeIPv6(normalized);

    // ::1 loopback (covers 0:0:0:0:0:0:0:1, 0000:0000:...:0001, etc.)
    if (canonical === '::1') return true;

    // :: (all-zeros, unspecified address)
    if (canonical === '::') return true;

    // fc00::/7 — starts with fc or fd
    if (canonical.startsWith('fc') || canonical.startsWith('fd')) return true;

    // fe80::/10 — link-local
    if (canonical.startsWith('fe80')) return true;

    return false;
  }

  return false;
}

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
  /** First public IP the hostname resolved to. Callers should pin requests to this IP. */
  resolvedIp?: string;
}

export async function validateUrl(url: string): Promise<UrlValidationResult> {
  // 1. Parse URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: 'Invalid URL' };
  }

  // 2. Require HTTPS
  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Only HTTPS URLs are allowed' };
  }

  // 3. Reject non-standard ports
  if (parsed.port !== '' && parsed.port !== '443') {
    return { valid: false, reason: 'Non-standard port not allowed' };
  }

  // 4. Reject localhost and .local
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  ) {
    return { valid: false, reason: 'Localhost URLs not allowed' };
  }

  // 5. DNS resolve — check all IPs against private ranges
  const [ipv4Result, ipv6Result] = await Promise.allSettled([
    dns.promises.resolve4(hostname),
    dns.promises.resolve6(hostname),
  ]);

  const allIps: string[] = [];

  if (ipv4Result.status === 'fulfilled') {
    allIps.push(...ipv4Result.value);
  }
  if (ipv6Result.status === 'fulfilled') {
    allIps.push(...ipv6Result.value);
  }

  for (const ip of allIps) {
    if (isPrivateIp(ip)) {
      return { valid: false, reason: 'URL resolves to private IP' };
    }
  }

  // 6. All checks passed — return first resolved IP so callers can pin to it
  return { valid: true, resolvedIp: allIps[0] };
}

/**
 * Validate a URL and fetch it atomically, pinning the connection to the
 * resolved IP to prevent DNS rebinding (TOCTOU) attacks.
 *
 * Connects directly to the validated IP address while preserving the original
 * Host header for TLS SNI and virtual hosting.
 *
 * Returns null response if validation fails, otherwise the fetch Response.
 */
export async function fetchValidated(
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
): Promise<
  { response: Response; validation: UrlValidationResult } | { response: null; validation: UrlValidationResult }
> {
  const validation = await validateUrl(url);
  if (!validation.valid || !validation.resolvedIp) {
    return { response: null, validation };
  }

  const parsed = new URL(url);
  const pinnedIp = validation.resolvedIp;

  // Replace hostname with the validated IP so DNS cannot rebind between
  // validation and the actual connection.
  const pinnedUrl = new URL(url);
  pinnedUrl.hostname = net.isIPv6(pinnedIp) ? `[${pinnedIp}]` : pinnedIp;

  const headers: Record<string, string> = {
    ...init?.headers,
    // Preserve original Host header for TLS SNI and virtual hosting
    Host: parsed.host,
  };

  const response = await fetch(pinnedUrl.toString(), {
    signal: init?.signal,
    headers,
  });

  return { response, validation };
}
