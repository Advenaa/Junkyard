import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici';

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
  /** First public IP the hostname resolved to after IPv4-first ordering. */
  resolvedIp?: string;
  /** All public IPs the hostname resolved to, ordered IPv4-first for fetch failover. */
  resolvedIps?: string[];
}

type ValidatedFetchInit = Parameters<typeof fetch>[1];
type ValidatedFetchInitWithDispatcher = ValidatedFetchInit & { dispatcher?: Dispatcher };

export const _internal = { fetch: undiciFetch as unknown as typeof globalThis.fetch };

const TRANSIENT_NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function sortResolvedIps(ips: string[]): string[] {
  return [...ips].sort((left, right) => {
    const leftPriority = net.isIPv4(left) ? 0 : 1;
    const rightPriority = net.isIPv4(right) ? 0 : 1;
    return leftPriority - rightPriority;
  });
}

function getErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) {
    return undefined;
  }

  const { code } = err as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}

function isTransientFetchError(err: unknown): boolean {
  const directCode = getErrorCode(err);
  if (directCode !== undefined && TRANSIENT_NETWORK_ERROR_CODES.has(directCode)) {
    return true;
  }

  if (!(err instanceof Error) || err.message !== 'fetch failed') {
    return false;
  }

  const causeCode = getErrorCode((err as Error & { cause?: unknown }).cause);
  return causeCode !== undefined && TRANSIENT_NETWORK_ERROR_CODES.has(causeCode);
}

function throwIfAborted(signal: AbortSignal | null | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  if (signal.reason instanceof Error) {
    throw signal.reason;
  }

  throw new DOMException(
    typeof signal.reason === 'string' && signal.reason.length > 0 ? signal.reason : 'The operation was aborted',
    'AbortError',
  );
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

  // 5. Literal IP hostnames bypass DNS resolution entirely, so validate them directly.
  const literalHost =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, hostname.length - 1) : hostname;
  if (net.isIP(literalHost)) {
    if (isPrivateIp(literalHost)) {
      return { valid: false, reason: 'URL resolves to private IP' };
    }
    return { valid: true, resolvedIp: literalHost };
  }

  // 6. DNS resolve — check all IPs against private ranges
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

  if (allIps.length === 0) {
    return { valid: false, reason: 'DNS resolution failed' };
  }

  const resolvedIps = sortResolvedIps(allIps);

  for (const ip of resolvedIps) {
    if (isPrivateIp(ip)) {
      return { valid: false, reason: 'URL resolves to private IP' };
    }
  }

  return {
    valid: true,
    resolvedIp: resolvedIps[0],
    resolvedIps,
  };
}

function createPinnedDispatcher(resolvedIp: string): Dispatcher {
  const family = net.isIP(resolvedIp);
  return new Agent({
    connections: 1,
    pipelining: 0,
    keepAliveTimeout: 1,
    keepAliveMaxTimeout: 1,
    connect: {
      lookup(_hostname, _options, callback) {
        callback(null, [{ address: resolvedIp, family }]);
      },
    },
  });
}

async function closeDispatcher(dispatcher: Dispatcher): Promise<void> {
  try {
    await dispatcher.close();
  } catch {
    // Best-effort cleanup only — original fetch/read errors are more useful.
  }
}

function bindDispatcherLifecycle(response: Response, dispatcher: Dispatcher): Response {
  let closed = false;
  const closeOnce = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await closeDispatcher(dispatcher);
  };

  const responseWithPatchedMethods = response as Response & Record<string, unknown>;
  for (const methodName of ['arrayBuffer', 'blob', 'bytes', 'formData', 'json', 'text'] as const) {
    const original = responseWithPatchedMethods[methodName];
    if (typeof original !== 'function') continue;
    Object.defineProperty(responseWithPatchedMethods, methodName, {
      configurable: true,
      value: async (...args: unknown[]) => {
        try {
          return await Reflect.apply(original, response, args);
        } finally {
          await closeOnce();
        }
      },
    });
  }

  const body = response.body as (ReadableStream<Uint8Array> & { cancel?: (reason?: unknown) => Promise<void> }) | null;
  if (body && typeof body.cancel === 'function') {
    const originalCancel = body.cancel.bind(body);
    Object.defineProperty(body, 'cancel', {
      configurable: true,
      value: async (reason?: unknown) => {
        try {
          return await originalCancel(reason);
        } finally {
          await closeOnce();
        }
      },
    });
  }

  if (response.body === null) {
    void closeOnce();
  }

  return response;
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
  init?: ValidatedFetchInit,
  existingValidation?: UrlValidationResult,
): Promise<
  { response: Response; validation: UrlValidationResult } | { response: null; validation: UrlValidationResult }
> {
  const validation = existingValidation ?? (await validateUrl(url));
  if (!validation.valid || !validation.resolvedIp) {
    return { response: null, validation };
  }

  const signal = init?.signal;
  const resolvedIps = validation.resolvedIps?.length ? validation.resolvedIps : [validation.resolvedIp];
  let lastTransientError: unknown;

  for (const resolvedIp of resolvedIps) {
    throwIfAborted(signal);

    const dispatcher = createPinnedDispatcher(resolvedIp);

    try {
      const response = await _internal.fetch(url, {
        ...(init ?? {}),
        dispatcher,
      } as ValidatedFetchInitWithDispatcher);

      return {
        response: bindDispatcherLifecycle(response, dispatcher),
        validation,
      };
    } catch (err) {
      await closeDispatcher(dispatcher);
      if (!isTransientFetchError(err)) {
        throw err;
      }

      lastTransientError = err;
      throwIfAborted(signal);
    }
  }

  throw lastTransientError;
}
