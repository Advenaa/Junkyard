import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import { Agent } from 'undici';
import { fetchValidated, validateUrl } from '../../src/url-validator.js';

describe('validateUrl', () => {
  it('should accept a valid HTTPS URL', async (t) => {
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['93.184.216.34']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });

    const result = await validateUrl('https://example.com');
    assert.strictEqual(result.valid, true);

    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('should reject HTTP URLs', async () => {
    const result = await validateUrl('http://example.com');
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason);
    assert.match(result.reason!, /https/i);
  });

  it('should reject localhost', async () => {
    const result = await validateUrl('https://localhost');
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason);
  });

  it('should reject IPv4 loopback address', async () => {
    const result = await validateUrl('https://127.0.0.1');
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason);
  });

  it('should reject raw private IP hostnames', async () => {
    const result = await validateUrl('https://10.0.0.1');
    assert.strictEqual(result.valid, false);
    assert.match(result.reason!, /private/i);
  });

  it('should reject raw private IP hostnames without consulting DNS', async (t) => {
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => {
      throw new Error('DNS should not run for literal IP hosts');
    });
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('DNS should not run for literal IP hosts');
    });

    const result = await validateUrl('https://10.0.0.1');
    assert.strictEqual(result.valid, false);
    assert.match(result.reason!, /private/i);
    assert.strictEqual(resolve4Mock.mock.callCount(), 0);
    assert.strictEqual(resolve6Mock.mock.callCount(), 0);

    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('should accept raw public IP hostnames', async () => {
    const result = await validateUrl('https://93.184.216.34');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.resolvedIp, '93.184.216.34');
  });

  it('should accept raw public IPv6 hostnames without consulting DNS', async (t) => {
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => {
      throw new Error('DNS should not run for literal IP hosts');
    });
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('DNS should not run for literal IP hosts');
    });

    const result = await validateUrl('https://[2606:4700:4700::1111]');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.resolvedIp, '2606:4700:4700::1111');
    assert.strictEqual(resolve4Mock.mock.callCount(), 0);
    assert.strictEqual(resolve6Mock.mock.callCount(), 0);

    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('should reject raw private IPv6 hostnames without consulting DNS', async (t) => {
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => {
      throw new Error('DNS should not run for literal IP hosts');
    });
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('DNS should not run for literal IP hosts');
    });

    const result = await validateUrl('https://[fd00::1]');
    assert.strictEqual(result.valid, false);
    assert.match(result.reason!, /private/i);
    assert.strictEqual(resolve4Mock.mock.callCount(), 0);
    assert.strictEqual(resolve6Mock.mock.callCount(), 0);

    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('should reject private IP 10.x.x.x via DNS resolution', async (t) => {
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['10.0.0.1']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });

    const result = await validateUrl('https://rebind-10-direct.example.com');
    assert.strictEqual(result.valid, false);
    assert.match(result.reason!, /private/i);

    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('should reject private IP 192.168.x.x via DNS resolution', async (t) => {
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['192.168.1.1']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });

    const result = await validateUrl('https://rebind-192-direct.example.com');
    assert.strictEqual(result.valid, false);
    assert.match(result.reason!, /private/i);

    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('should reject private IP 172.16.x.x via DNS resolution', async (t) => {
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['172.16.0.1']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });

    const result = await validateUrl('https://rebind-172-direct.example.com');
    assert.strictEqual(result.valid, false);
    assert.match(result.reason!, /private/i);

    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('should reject non-standard ports', async () => {
    const result = await validateUrl('https://example.com:8080');
    assert.strictEqual(result.valid, false);
    assert.match(result.reason!, /port/i);
  });

  it('should reject file:// protocol', async () => {
    const result = await validateUrl('file:///etc/passwd');
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason);
  });

  it('should reject invalid URL strings', async () => {
    const result = await validateUrl('not-a-url');
    assert.strictEqual(result.valid, false);
    assert.match(result.reason!, /invalid/i);
  });

  it('should reject IPv6 loopback address', async () => {
    const result = await validateUrl('https://[::1]');
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason);
  });

  // --- Private IP range coverage ---

  it('should reject when DNS resolves to 127.0.0.2 (127.x range)', async (t) => {
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['127.0.0.2']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });

    const result = await validateUrl('https://rebind-127.example.com');
    assert.strictEqual(result.valid, false);
    assert.match(result.reason!, /private/i);

    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('should reject when DNS resolves to 10.255.255.255 (end of 10.x range)', async (t) => {
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['10.255.255.255']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });

    const result = await validateUrl('https://rebind-10.example.com');
    assert.strictEqual(result.valid, false);
    assert.match(result.reason!, /private/i);

    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('should reject when DNS resolves to 172.31.255.255 (end of 172.16-31 range)', async (t) => {
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['172.31.255.255']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });

    const result = await validateUrl('https://rebind-172.example.com');
    assert.strictEqual(result.valid, false);
    assert.match(result.reason!, /private/i);

    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('should reject when DNS resolves to 169.254.169.254 (link-local)', async (t) => {
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['169.254.169.254']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });

    const result = await validateUrl('https://rebind-metadata.example.com');
    assert.strictEqual(result.valid, false);
    assert.match(result.reason!, /private/i);

    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('should reject when DNS resolves to 192.168.x.x', async (t) => {
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['192.168.0.1']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });

    const result = await validateUrl('https://rebind-192.example.com');
    assert.strictEqual(result.valid, false);
    assert.match(result.reason!, /private/i);

    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  // --- DNS resolution to private IP ---

  it('should reject URL that DNS-resolves to private IP (IPv6-mapped IPv4)', async (t) => {
    // Mock DNS to return an IPv6-mapped IPv4 private address
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['127.0.0.1']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });

    const result = await validateUrl('https://evil-rebind.example.com');
    assert.strictEqual(result.valid, false);
    assert.match(result.reason!, /private/i);

    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('should reject URL when DNS resolves to 10.x private IP', async (t) => {
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['10.0.0.1']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });

    const result = await validateUrl('https://sneaky.example.com');
    assert.strictEqual(result.valid, false);
    assert.match(result.reason!, /private/i);

    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('should return valid when DNS resolves to public IP', async (t) => {
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['93.184.216.34']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });

    const result = await validateUrl('https://safe.example.com');
    assert.strictEqual(result.valid, true);

    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('should reject when DNS has no records (both fail)', async (t) => {
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => {
      throw new Error('ENOTFOUND');
    });
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('ENOTFOUND');
    });

    const result = await validateUrl('https://no-dns.example.com');
    assert.strictEqual(result.valid, false);
    assert.match(result.reason!, /dns|resolve/i);

    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  // --- Non-standard port variations ---

  it('should reject port 443 alternative (8443)', async () => {
    const result = await validateUrl('https://example.com:8443');
    assert.strictEqual(result.valid, false);
    assert.match(result.reason!, /port/i);
  });

  it('should accept explicit port 443', async (t) => {
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['93.184.216.34']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });

    const result = await validateUrl('https://example.com:443');
    assert.strictEqual(result.valid, true);

    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  // --- HTTPS-only enforcement ---

  it('should reject ftp:// protocol', async () => {
    const result = await validateUrl('ftp://example.com/file');
    assert.strictEqual(result.valid, false);
    assert.match(result.reason!, /https/i);
  });

  it('should reject javascript: protocol', async () => {
    const result = await validateUrl('javascript:alert(1)');
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason);
  });

  // --- .local domain ---

  it('should reject .local domains', async () => {
    const result = await validateUrl('https://myserver.local');
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason);
  });
});

describe('fetchValidated', () => {
  it('pins fetches with a dispatcher while preserving the original URL', async (t) => {
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['93.184.216.34']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('ok', { status: 200 }));

    const result = await fetchValidated('https://safe.example.com', {
      headers: { Accept: 'text/plain' },
    });

    assert.ok(result.response);
    assert.strictEqual(result.validation.valid, true);
    assert.strictEqual(await result.response.text(), 'ok');
    assert.strictEqual(fetchMock.mock.callCount(), 1);

    const [url, init] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit & { dispatcher?: unknown }];
    assert.strictEqual(url, 'https://safe.example.com');
    assert.ok(init.dispatcher, 'fetchValidated should attach a pinned dispatcher');

    fetchMock.mock.restore();
    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('closes the pinned dispatcher after response.text() consumes the body', async (t) => {
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['93.184.216.34']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('ok', { status: 200 }));
    const closeMock = t.mock.method(Agent.prototype, 'close', async () => undefined);

    const result = await fetchValidated('https://safe.example.com');

    assert.ok(result.response);
    assert.strictEqual(await result.response.text(), 'ok');
    assert.strictEqual(closeMock.mock.callCount(), 1);

    closeMock.mock.restore();
    fetchMock.mock.restore();
    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('closes the pinned dispatcher when the caller cancels the response body', async (t) => {
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['93.184.216.34']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('ok', { status: 200 }));
    const closeMock = t.mock.method(Agent.prototype, 'close', async () => undefined);

    const result = await fetchValidated('https://safe.example.com');

    assert.ok(result.response);
    assert.ok(result.response.body, 'expected response body so cancel() can be exercised');
    await result.response.body!.cancel();
    assert.strictEqual(closeMock.mock.callCount(), 1);

    closeMock.mock.restore();
    fetchMock.mock.restore();
    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('reuses an existing validation without performing a fresh DNS lookup', async (t) => {
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['203.0.113.10']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => ['2001:db8::10']);
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('ok', { status: 200 }));

    const result = await fetchValidated(
      'https://safe.example.com',
      { method: 'POST', body: 'payload' },
      { valid: true, resolvedIp: '93.184.216.34' },
    );

    assert.ok(result.response);
    await result.response.text();
    assert.strictEqual(resolve4Mock.mock.callCount(), 0);
    assert.strictEqual(resolve6Mock.mock.callCount(), 0);
    assert.strictEqual(fetchMock.mock.callCount(), 1);

    fetchMock.mock.restore();
    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('returns a null response and skips fetch when validation fails', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('ok', { status: 200 }));

    const result = await fetchValidated('http://example.com');

    assert.strictEqual(result.response, null);
    assert.strictEqual(result.validation.valid, false);
    assert.strictEqual(fetchMock.mock.callCount(), 0);

    fetchMock.mock.restore();
  });
});
