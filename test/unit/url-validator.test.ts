import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateUrl } from '../../src/url-validator.js';

describe('validateUrl', () => {
  it('should accept a valid HTTPS URL', async () => {
    const result = await validateUrl('https://example.com');
    assert.strictEqual(result.valid, true);
  });

  it('should reject HTTP URLs', async () => {
    const result = await validateUrl('http://example.com');
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason, 'expected a reason for rejection');
  });

  it('should reject localhost', async () => {
    const result = await validateUrl('https://localhost');
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason, 'expected a reason for rejection');
  });

  it('should reject IPv4 loopback address', async () => {
    const result = await validateUrl('https://127.0.0.1');
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason, 'expected a reason for rejection');
  });

  it('should reject private IP 10.x.x.x', async () => {
    const result = await validateUrl('https://10.0.0.1');
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason, 'expected a reason for rejection');
  });

  it('should reject private IP 192.168.x.x', async () => {
    const result = await validateUrl('https://192.168.1.1');
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason, 'expected a reason for rejection');
  });

  it('should reject private IP 172.16.x.x', async () => {
    const result = await validateUrl('https://172.16.0.1');
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason, 'expected a reason for rejection');
  });

  it('should reject non-standard ports', async () => {
    const result = await validateUrl('https://example.com:8080');
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason, 'expected a reason for rejection');
  });

  it('should reject file:// protocol', async () => {
    const result = await validateUrl('file:///etc/passwd');
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason, 'expected a reason for rejection');
  });

  it('should reject invalid URL strings', async () => {
    const result = await validateUrl('not-a-url');
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason, 'expected a reason for rejection');
  });

  it('should reject IPv6 loopback address', async () => {
    const result = await validateUrl('https://[::1]');
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason, 'expected a reason for rejection');
  });
});
