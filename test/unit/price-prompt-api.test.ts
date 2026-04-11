/**
 * Structural regression tests for Price Feeds 3.1 — Prompt injection + API (Cycle 273).
 *
 * Verifies:
 * - MarketReportLLMSchema includes priceAlerts
 * - synthesize.ts injects <price_context> and has contrarian detection
 * - pulse.ts injects <price_context> and has contrarian detection
 * - server.ts has price endpoint
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
// Schema: priceAlerts
// ═══════════════════════════════════════════════════════════════════════

describe('MarketReportLLMSchema includes priceAlerts', () => {
  const schemas = readSrc('src/process/schemas.ts');

  it('has priceAlerts field in MarketReportLLMSchema', () => {
    assert.match(schemas, /priceAlerts\s*:\s*z\.array\((?:z\.string\(\)|nonEmptyText)\)/);
  });

  it('priceAlerts has max 5 default empty', () => {
    assert.match(schemas, /priceAlerts.*\.max\(5\)/);
    assert.match(schemas, /priceAlerts.*\.default\(\[\]\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// synthesize.ts: price context injection
// ═══════════════════════════════════════════════════════════════════════

describe('synthesize.ts price context injection', () => {
  const synth = readSrc('src/process/synthesize.ts');

  it('imports getLatestPricesForEntities', () => {
    assert.ok(synth.includes('getLatestPricesForEntities'));
  });

  it('builds price_context XML block', () => {
    assert.ok(synth.includes('<price_context>'));
  });

  it('has contrarian detection logic', () => {
    assert.ok(synth.includes('CONTRARIAN'));
    assert.match(synth, /contrarian/);
  });

  it('detects bearish sentiment with rising price', () => {
    assert.match(synth, /sentiment\s*<.*-0\.2.*priceChange24h.*>.*3|priceChange24h.*>.*3.*sentiment\s*<.*-0\.2/s);
  });

  it('detects bullish sentiment with falling price', () => {
    assert.match(synth, /sentiment\s*>.*0\.2.*priceChange24h.*<.*-3|priceChange24h.*<.*-3.*sentiment\s*>.*0\.2/s);
  });

  it('system prompt mentions price_context', () => {
    assert.match(synth, /When.*<price_context>/);
  });

  it('system prompt mentions priceAlerts', () => {
    assert.ok(synth.includes('priceAlerts'));
  });

  it('passes priceContext to buildDailyUserMessage', () => {
    assert.ok(synth.includes('priceContext'));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// pulse.ts: price context injection
// ═══════════════════════════════════════════════════════════════════════

describe('pulse.ts price context injection', () => {
  const pulse = readSrc('src/process/pulse.ts');

  it('imports getLatestPricesForEntities', () => {
    assert.ok(pulse.includes('getLatestPricesForEntities'));
  });

  it('builds price_context XML block', () => {
    assert.ok(pulse.includes('<price_context>'));
  });

  it('has contrarian detection logic', () => {
    assert.ok(pulse.includes('CONTRARIAN'));
  });

  it('system prompt mentions price_context', () => {
    assert.match(pulse, /When.*<price_context>/);
  });

  it('system prompt mentions priceAlerts', () => {
    assert.ok(pulse.includes('priceAlerts'));
  });

  it('passes priceContext to buildUserMessage', () => {
    assert.ok(pulse.includes('priceContext'));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// server.ts: price endpoint
// ═══════════════════════════════════════════════════════════════════════

describe('server.ts entity price endpoint', () => {
  const server = readServerSource();

  it('has GET /entities/:entityId/price route', () => {
    assert.match(server, /\/api\/v1\/entities\/:entityId\/price/);
  });

  it('imports getLatestPriceSnapshot', () => {
    assert.ok(server.includes('getLatestPriceSnapshot'));
  });

  it('imports getPriceHistory', () => {
    assert.ok(server.includes('getPriceHistory'));
  });

  it('supports days query parameter', () => {
    // The route schema should define days as an integer parameter
    assert.match(server, /days.*integer|integer.*days/s);
  });

  it('returns 404 when no price data', () => {
    assert.ok(server.includes('No price data for this entity'));
  });

  it('returns latest and history', () => {
    assert.ok(server.includes('latest'));
    assert.ok(server.includes('history'));
  });
});
