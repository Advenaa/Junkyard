import dns from 'node:dns';
import net from 'node:net';

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

    // ::1 loopback
    if (normalized === '::1') return true;

    // fc00::/7 — starts with fc or fd
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

    // fe80::/10 — link-local
    if (normalized.startsWith('fe80')) return true;

    return false;
  }

  return false;
}

export async function validateUrl(
  url: string,
): Promise<{ valid: boolean; reason?: string }> {
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

  // 6. All checks passed
  return { valid: true };
}
