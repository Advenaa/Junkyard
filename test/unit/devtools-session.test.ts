import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const adminRoutesSrc = readFileSync(resolve(ROOT, 'src/server-admin-routes.ts'), 'utf-8');

describe('POST /api/v1/auth/devtools-session (structural)', () => {
  it('route is registered in server-admin-routes.ts', () => {
    assert.ok(adminRoutesSrc.includes('/api/v1/auth/devtools-session'), 'Endpoint path must exist');
  });

  it('requires admin auth', () => {
    assert.ok(adminRoutesSrc.includes('requireAdmin'), 'Must use requireAdmin preHandler');
  });

  it('upserts a synthetic devtools user with discord_id 0', () => {
    assert.ok(adminRoutesSrc.includes("DEVTOOLS_DISCORD_ID = '0'"), 'Must use discord_id 0');
    assert.ok(
      adminRoutesSrc.includes('INSERT INTO users') && adminRoutesSrc.includes('ON CONFLICT'),
      'Must upsert user row',
    );
  });

  it('creates a session via sessionManager.create', () => {
    assert.ok(adminRoutesSrc.includes('sessionManager.create'), 'Must call sessionManager.create');
  });

  it('sets the podders_session cookie', () => {
    const cookieSetCount = (adminRoutesSrc.match(/setCookie\('podders_session'/g) ?? []).length;
    assert.ok(cookieSetCount >= 1, 'Must set podders_session cookie');
  });

  it('returns the session id in the response body', () => {
    assert.ok(adminRoutesSrc.includes('podders_session: sessionId'), 'Must return session in JSON body');
  });

  it('SessionManagerLike includes create method', () => {
    assert.ok(
      adminRoutesSrc.includes('create(discordId: string, ip: string, userAgent: string): Promise<string>'),
      'SessionManagerLike must include create signature',
    );
  });
});
