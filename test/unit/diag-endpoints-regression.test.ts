/**
 * Structural regression tests for admin diagnostic endpoints.
 *
 * These endpoints surface production signals (stuck items, backpressure,
 * halted sources, recent error/critical health events) through read-only
 * admin-auth routes so /scout runtime can file findings based on live
 * data without needing SSH or direct DB access.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const server = readFileSync(resolve(root, 'src/server.ts'), 'utf-8');

const diagRoutes = [
  '/api/v1/diag/stuck-items',
  '/api/v1/diag/backpressure',
  '/api/v1/diag/halted-sources',
  '/api/v1/diag/health-events',
];

describe('diag endpoints — registration + admin auth', () => {
  for (const route of diagRoutes) {
    it(`${route} is registered as a GET route`, () => {
      const escaped = route.replace(/\//g, '\\/');
      const pattern = new RegExp(`app\\.get(?:<[^>]*>)?\\(\\s*['"]${escaped}['"]`);
      assert.match(server, pattern, `${route} must be registered with app.get`);
    });

    it(`${route} uses [authPreHandler, requireAdmin]`, () => {
      const routeIdx = server.indexOf(`'${route}'`);
      assert.ok(routeIdx !== -1, `${route} literal must appear in server.ts`);
      const block = server.slice(routeIdx, routeIdx + 600);
      assert.match(
        block,
        /preHandler:\s*\[\s*authPreHandler\s*,\s*requireAdmin\s*\]/,
        `${route} must gate on preHandler: [authPreHandler, requireAdmin]`,
      );
    });
  }
});

describe('diag endpoints — queries hit the right tables', () => {
  function routeBlock(route: string, span = 2500): string {
    const idx = server.indexOf(`'${route}'`);
    assert.ok(idx !== -1, `${route} literal must appear in server.ts`);
    return server.slice(idx, idx + span);
  }

  it('stuck-items filters items WHERE status = processing', () => {
    const block = routeBlock('/api/v1/diag/stuck-items');
    assert.match(block, /FROM\s+items/i);
    assert.match(block, /status\s*=\s*'processing'/);
  });

  it('stuck-items compares created_at against a threshold', () => {
    const block = routeBlock('/api/v1/diag/stuck-items');
    assert.match(block, /created_at\s*<\s*\$1::bigint\s*-\s*\$2::bigint/);
  });

  it('backpressure reports ready and processing counts', () => {
    const block = routeBlock('/api/v1/diag/backpressure');
    assert.match(block, /status\s*=\s*'ready'/);
    assert.match(block, /status\s*=\s*'processing'/);
  });

  it('halted-sources joins sources with source_state filtered to halted', () => {
    const block = routeBlock('/api/v1/diag/halted-sources');
    assert.match(block, /FROM\s+sources/i);
    assert.match(block, /JOIN\s+source_state/i);
    assert.match(block, /status\s*=\s*'halted'/);
  });

  it('health-events filters to error/critical severity since a timestamp', () => {
    const block = routeBlock('/api/v1/diag/health-events');
    assert.match(block, /FROM\s+health_events/i);
    assert.match(block, /severity\s+IN\s*\(\s*'error'\s*,\s*'critical'\s*\)/i);
    assert.match(block, /created_at\s*>=\s*\$1::bigint/);
  });

  it('health-events limits the response and caps at 200', () => {
    const block = routeBlock('/api/v1/diag/health-events');
    assert.match(block, /limit:\s*\{\s*type:\s*'integer'[^}]*maximum:\s*200/);
  });
});
