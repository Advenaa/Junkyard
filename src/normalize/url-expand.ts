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

  try {
    // Quick validation — will throw on invalid URLs
    new URL(current);
  } catch {
    return url;
  }

  for (let i = 0; i < MAX_REDIRECTS; i++) {
    try {
      const response = await fetch(current, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      });

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
    } catch {
      return current;
    }
  }

  return current;
}
