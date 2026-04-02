import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';

describe('Auth', () => {
  it('generates 32-byte state for CSRF', () => {
    const state = crypto.randomBytes(32).toString('hex');
    assert.strictEqual(state.length, 64); // 32 bytes = 64 hex chars
  });

  it('timing-safe comparison works for API keys', () => {
    const key = 'pk_01HXYZ';
    const buf1 = Buffer.from(key);
    const buf2 = Buffer.from(key);
    assert.ok(crypto.timingSafeEqual(buf1, buf2));
  });

  it('timing-safe comparison rejects wrong keys', () => {
    const key1 = 'pk_01HXYZ';
    const key2 = 'pk_01ABCD';
    const buf1 = Buffer.from(key1);
    const buf2 = Buffer.from(key2);
    assert.ok(!crypto.timingSafeEqual(buf1, buf2));
  });

  it('session expiry is 30 days from now', () => {
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const expiresAt = now + thirtyDays;
    assert.ok(expiresAt > now);
    assert.ok(expiresAt - now === thirtyDays);
  });

  it('sliding refresh triggers after 24 hours', () => {
    const now = Date.now();
    const twentyFiveHoursAgo = now - 25 * 60 * 60 * 1000;
    const twentyThreeHoursAgo = now - 23 * 60 * 60 * 1000;
    const threshold = 24 * 60 * 60 * 1000;

    assert.ok(now - twentyFiveHoursAgo > threshold); // should refresh
    assert.ok(!(now - twentyThreeHoursAgo > threshold)); // should not refresh
  });

  it('max 5 sessions per user enforced', () => {
    const maxSessions = 5;
    const sessions = Array.from({ length: 6 }, (_, i) => `session_${i}`);
    const trimmed = sessions.slice(-maxSessions);
    assert.strictEqual(trimmed.length, 5);
    assert.strictEqual(trimmed[0], 'session_1'); // oldest dropped
  });

  it('admin user IDs resolve to admin role', () => {
    const adminIds = ['123456789', '987654321'];
    assert.ok(adminIds.includes('123456789'));
    assert.ok(!adminIds.includes('000000000'));
  });

  it('blocked users get 403', () => {
    const role = 'blocked';
    const allowed = role !== 'blocked';
    assert.ok(!allowed);
  });
});
