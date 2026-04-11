/**
 * Structural regression tests for Alpha Decay 3.6 Cycle 278 — Prompt + API.
 *
 * Verifies:
 * - Synthesize: alpha propagation prompt injection (interface, params, XML block, system prompt, fetch + try/catch)
 * - Pulse: alpha propagation prompt injection (import, params, XML block, system prompt)
 * - Server: alpha propagation API route (import, route path, auth, query param, 404)
 * - Dashboard: Settings alpha propagation card (types, fetch, rendering)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readServerSource } from './helpers/server-source.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

// ═══════════════════════════════════════════════════════════════════════
// Synthesize: alpha propagation prompt injection
// ═══════════════════════════════════════════════════════════════════════

describe('Synthesize: alpha propagation prompt injection', () => {
  const src = readSrc('src/process/synthesize.ts');

  it('imports getAlphaPropagationSummary from ../db/queries.js', () => {
    assert.match(src, /getAlphaPropagationSummary/);
    assert.match(src, /from\s+['"]\.\.\/db\/queries\.js['"]/);
  });

  it('defines AlphaPropagationContext interface', () => {
    assert.match(src, /interface AlphaPropagationContext/);
  });

  it('buildDailyUserMessage signature includes alphaPropagation parameter', () => {
    assert.match(src, /buildDailyUserMessage[\s\S]*?alphaPropagation/);
  });

  it('renders <alpha_propagation> XML block', () => {
    assert.match(src, /<alpha_propagation>/);
    assert.match(src, /<\/alpha_propagation>/);
  });

  it('system prompt mentions alpha_propagation', () => {
    // The DAILY_SYSTEM_PROMPT contains instructions for When <alpha_propagation> data is provided
    assert.match(src, /When <alpha_propagation> data is provided/);
  });

  it('fetches alpha propagation data (contains getAlphaPropagationSummary call)', () => {
    assert.match(src, /getAlphaPropagationSummary\(pool,/);
  });

  it('wraps alpha fetch in try/catch', () => {
    // The alpha propagation fetch is wrapped in try/catch for graceful degradation
    assert.match(src, /try\s*\{[\s\S]*?getAlphaPropagationSummary[\s\S]*?\}\s*catch/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Pulse: alpha propagation prompt injection
// ═══════════════════════════════════════════════════════════════════════

describe('Pulse: alpha propagation prompt injection', () => {
  const src = readSrc('src/process/pulse.ts');

  it('imports getAlphaPropagationSummary from ../db/queries.js', () => {
    assert.match(src, /getAlphaPropagationSummary/);
    assert.match(src, /from\s+['"]\.\.\/db\/queries\.js['"]/);
  });

  it('buildUserMessage signature includes alphaPropagation parameter', () => {
    assert.match(src, /buildUserMessage[\s\S]*?alphaPropagation/);
  });

  it('renders <alpha_propagation> XML block', () => {
    assert.match(src, /<alpha_propagation>/);
    assert.match(src, /<\/alpha_propagation>/);
  });

  it('system prompt mentions alpha_propagation', () => {
    assert.match(src, /When <alpha_propagation> data is provided/);
  });

  it('fetches alpha propagation data in runPulse', () => {
    assert.match(src, /getAlphaPropagationSummary\(pool,/);
  });

  it('wraps alpha fetch in try/catch', () => {
    assert.match(src, /try\s*\{[\s\S]*?getAlphaPropagationSummary[\s\S]*?\}\s*catch/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Server: alpha propagation API
// ═══════════════════════════════════════════════════════════════════════

describe('Server: alpha propagation API', () => {
  const src = readServerSource();

  it('imports getAlphaPropagationSummary from queries', () => {
    assert.match(src, /getAlphaPropagationSummary/);
  });

  it('imports getAlphaPropagationByEntity from queries', () => {
    assert.match(src, /getAlphaPropagationByEntity/);
  });

  it('has route /api/v1/entities/:entityId/alpha', () => {
    assert.match(src, /\/api\/v1\/entities\/:entityId\/alpha/);
  });

  it('route uses authPreHandler', () => {
    // The alpha route should be protected by auth
    // Check that authPreHandler appears in the route definition context
    const routeIdx = src.indexOf('/api/v1/entities/:entityId/alpha');
    assert.ok(routeIdx > 0, 'Route must exist in server.ts');
    // Look within a reasonable window around the route for authPreHandler
    const contextStart = Math.max(0, routeIdx - 200);
    const contextEnd = Math.min(src.length, routeIdx + 200);
    const context = src.slice(contextStart, contextEnd);
    assert.match(context, /authPreHandler/);
  });

  it('route accepts days query parameter', () => {
    const routeIdx = src.indexOf('/api/v1/entities/:entityId/alpha');
    assert.ok(routeIdx > 0, 'Route must exist');
    const contextEnd = Math.min(src.length, routeIdx + 500);
    const context = src.slice(routeIdx, contextEnd);
    assert.match(context, /days/);
  });

  it('returns 404 when no data', () => {
    const routeIdx = src.indexOf('/api/v1/entities/:entityId/alpha');
    assert.ok(routeIdx > 0, 'Route must exist');
    const contextEnd = Math.min(src.length, routeIdx + 1200);
    const context = src.slice(routeIdx, contextEnd);
    assert.match(context, /404/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Dashboard: Settings alpha propagation card
// ═══════════════════════════════════════════════════════════════════════

describe('Dashboard: Settings alpha propagation card', () => {
  const src = readSrc('dashboard/src/pages/Settings.tsx');

  it('defines AlphaPropagationData interface', () => {
    assert.match(src, /interface AlphaPropagationData/);
  });

  it('defines AlphaPropagationSummaryEntry interface', () => {
    assert.match(src, /interface AlphaPropagationSummaryEntry/);
  });

  it('fetches alpha propagation data via /entities/:id/alpha', () => {
    assert.ok(src.includes('fetchAlphaPropagation'));
    assert.match(src, /\/entities\/.*\/alpha/);
  });

  it('renders Alpha Propagation heading', () => {
    assert.ok(src.includes('Alpha Propagation'));
  });

  it('fetchAlphaPropagation returns null on error', () => {
    assert.match(src, /fetchAlphaPropagation[\s\S]*?catch[\s\S]*?return null/);
  });
});
