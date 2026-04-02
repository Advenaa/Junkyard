import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import { validateUrl } from '../../src/url-validator.js';

describe('validateUrl', () => {
  it('should accept a valid HTTPS URL', async () => {
    const result = await validateUrl('https://example.com');
    assert.strictEqual(result.valid, true);
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

  // NOTE: Raw private IPs as hostnames (10.x, 192.168.x, 172.16.x) bypass the
  // hostname-level check (only 127.0.0.1 and ::1 are blocked there) and DNS
  // resolution fails for raw IPs, so they currently pass validation. This is a
  // known gap in the source. The DNS-based tests below verify that the private
  // IP check works when DNS resolves a hostname to these ranges.

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

  it('should pass when DNS has no records (both fail)', async (t) => {
    // When both resolve4 and resolve6 reject, allIps is empty, no private check triggers
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => {
      throw new Error('ENOTFOUND');
    });
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('ENOTFOUND');
    });

    const result = await validateUrl('https://no-dns.example.com');
    // No IPs resolved means no private IP check fails, so it passes
    assert.strictEqual(result.valid, true);

    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  // --- Non-standard port variations ---

  it('should reject port 443 alternative (8443)', async () => {
    const result = await validateUrl('https://example.com:8443');
    assert.strictEqual(result.valid, false);
    assert.match(result.reason!, /port/i);
  });

  it('should accept explicit port 443', async () => {
    const result = await validateUrl('https://example.com:443');
    assert.strictEqual(result.valid, true);
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
