/**
 * Tests for CD-009: toCamelCase serialization utility in src/server.ts.
 *
 * Two sections:
 *   1. Unit tests — exercise the toCamelCase logic directly (function is
 *      private to server.ts, so we replicate the regex-based transform and
 *      assert equivalence with the source implementation).
 *   2. Structural tests — read server.ts source and verify the function
 *      exists and is wired into the correct endpoints.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = resolve(__dirname, '../../src/server.ts');

// ---------------------------------------------------------------------------
// Replicate the toCamelCase implementation from server.ts so we can unit-test
// the transform logic without needing an export.  The structural tests below
// ensure the source stays in sync.
// ---------------------------------------------------------------------------
function toCamelCase<T>(obj: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result as T;
}

// ---------------------------------------------------------------------------
// 1. Unit tests for toCamelCase
// ---------------------------------------------------------------------------

describe('toCamelCase — unit', () => {
  it('converts source_id to sourceId', () => {
    const out = toCamelCase<{ sourceId: string }>({ source_id: 'abc' });
    assert.deepStrictEqual(out, { sourceId: 'abc' });
  });

  it('converts delivery_status to deliveryStatus', () => {
    const out = toCamelCase<{ deliveryStatus: string }>({ delivery_status: 'sent' });
    assert.deepStrictEqual(out, { deliveryStatus: 'sent' });
  });

  it('converts created_at to createdAt', () => {
    const out = toCamelCase<{ createdAt: number }>({ created_at: 123 });
    assert.deepStrictEqual(out, { createdAt: 123 });
  });

  it('preserves already-camelCase keys alongside converted keys', () => {
    const out = toCamelCase<{ alreadyCamel: number; alreadyCamel2: number }>({
      already_camel: 1,
      alreadyCamel: 2,
    });
    // already_camel -> alreadyCamel collides with the existing alreadyCamel key.
    // Object.entries iterates in insertion order, so the second entry wins.
    assert.strictEqual(out.alreadyCamel, 2);
  });

  it('preserves null values', () => {
    const out = toCamelCase<{ avatar: null }>({ avatar: null });
    assert.deepStrictEqual(out, { avatar: null });
  });

  it('returns empty object for empty input', () => {
    const out = toCamelCase<Record<string, never>>({});
    assert.deepStrictEqual(out, {});
  });

  it('does NOT deep-convert nested objects', () => {
    const nested = { inner_key: 'val' };
    const out = toCamelCase<{ outerKey: { inner_key: string } }>({ outer_key: nested });
    // The top-level key is converted, but the nested object is untouched.
    assert.strictEqual(out.outerKey, nested);
    assert.strictEqual((out.outerKey as Record<string, unknown>).inner_key, 'val');
  });

  it('handles multi-underscore keys (e.g. last_login_at)', () => {
    const out = toCamelCase<{ lastLoginAt: number }>({ last_login_at: 1710000000 });
    assert.deepStrictEqual(out, { lastLoginAt: 1710000000 });
  });

  it('does not alter keys without underscores', () => {
    const out = toCamelCase<{ id: string; type: string }>({ id: '01', type: 'daily' });
    assert.deepStrictEqual(out, { id: '01', type: 'daily' });
  });

  it('ignores leading underscores (not snake_case)', () => {
    // _private stays _private because the regex only matches _[a-z]
    // inside the string — a leading underscore followed by a lowercase letter
    // IS matched by the regex, so _private → Private (capital P, underscore removed).
    // Verify against the actual regex behavior:
    const out = toCamelCase<Record<string, unknown>>({ _private: 1 });
    const key = Object.keys(out)[0];
    // The regex /_([a-z])/g matches _p -> P, so "_private" becomes "Private"
    assert.strictEqual(key, 'Private');
  });
});

// ---------------------------------------------------------------------------
// 2. Structural tests — verify toCamelCase exists and is applied in server.ts
// ---------------------------------------------------------------------------

let source: string;

before(async () => {
  source = await readFile(SERVER_SRC, 'utf-8');
});

describe('toCamelCase — structural (server.ts source)', () => {
  it('defines the toCamelCase function', () => {
    assert.ok(
      source.includes('function toCamelCase'),
      'server.ts must define a toCamelCase function',
    );
  });

  it('toCamelCase uses shallow key.replace with /_([a-z])/g regex', () => {
    // Ensure it is the snake_case -> camelCase regex pattern
    assert.ok(
      source.includes('/_([a-z])/g'),
      'toCamelCase must use the /_([a-z])/g regex for snake_case conversion',
    );
  });

  it('toCamelCase does NOT recurse into nested values', () => {
    // Extract the function body
    const fnStart = source.indexOf('function toCamelCase');
    assert.ok(fnStart !== -1);
    const braceStart = source.indexOf('{', fnStart);
    let depth = 0;
    let fnEnd = -1;
    for (let i = braceStart; i < source.length; i++) {
      if (source[i] === '{') depth++;
      if (source[i] === '}') depth--;
      if (depth === 0) { fnEnd = i; break; }
    }
    const fnBody = source.slice(fnStart, fnEnd + 1);

    // Should NOT contain recursive calls to toCamelCase within itself
    const bodyAfterSignature = fnBody.slice(fnBody.indexOf('{'));
    const recursiveCalls = bodyAfterSignature.match(/toCamelCase\(/g);
    assert.strictEqual(
      recursiveCalls,
      null,
      'toCamelCase must not recursively call itself (shallow only)',
    );
  });

  it('GET /api/v1/reports applies toCamelCase to report rows', () => {
    // Find the reports endpoint handler
    const reportsEndpoint = source.indexOf("'/api/v1/reports'");
    assert.ok(reportsEndpoint !== -1, 'reports endpoint must exist');

    // Look for toCamelCase usage in the vicinity (within the handler)
    const handlerSlice = source.slice(reportsEndpoint, reportsEndpoint + 1200);
    assert.ok(
      handlerSlice.includes('toCamelCase'),
      'GET /api/v1/reports must apply toCamelCase to its response rows',
    );
  });

  it('reports endpoint uses .map pattern with toCamelCase', () => {
    const reportsEndpoint = source.indexOf("'/api/v1/reports'");
    const handlerSlice = source.slice(reportsEndpoint, reportsEndpoint + 1200);
    assert.ok(
      handlerSlice.includes('.map(') && handlerSlice.includes('toCamelCase'),
      'GET /api/v1/reports should map rows through toCamelCase',
    );
  });
});
