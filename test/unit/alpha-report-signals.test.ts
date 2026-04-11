/**
 * Structural regression tests for report-level alpha signals (Cycle 359).
 *
 * Verifies:
 * - MarketReportLLMSchema includes alphaSignals
 * - daily/pulse prompts instruct the model to populate alphaSignals from alpha propagation context
 * - reports/:id exposes alphaSignals from stored report bodies
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

describe('MarketReportLLMSchema includes alphaSignals', () => {
  const schemas = readSrc('src/process/schemas.ts');

  it('has alphaSignals field in MarketReportLLMSchema', () => {
    assert.match(schemas, /alphaSignals\s*:\s*z\.array\((?:z\.string\(\)|nonEmptyText)\)/);
  });

  it('alphaSignals has max 5 default empty', () => {
    assert.match(schemas, /alphaSignals.*\.max\(5\)/);
    assert.match(schemas, /alphaSignals.*\.default\(\[\]\)/);
  });
});

describe('Daily and pulse prompts mention alphaSignals', () => {
  const synth = readSrc('src/process/synthesize.ts');
  const pulse = readSrc('src/process/pulse.ts');

  it('daily prompt schema includes alphaSignals', () => {
    assert.ok(synth.includes('"alphaSignals"'));
  });

  it('daily alpha_propagation instructions mention alphaSignals', () => {
    assert.match(synth, /<alpha_propagation>[\s\S]*alphaSignals/);
  });

  it('pulse prompt schema includes alphaSignals', () => {
    assert.ok(pulse.includes('"alphaSignals"'));
  });

  it('pulse alpha_propagation instructions mention alphaSignals', () => {
    assert.match(pulse, /<alpha_propagation>[\s\S]*alphaSignals/);
  });
});

describe('reports/:id exposes alphaSignals', () => {
  const server = readServerSource();

  it('extracts alphaSignals from parsed report bodies', () => {
    assert.ok(server.includes('report.alphaSignals'));
    assert.match(server, /parsed\.alphaSignals\s*\?\?\s*parsed\.alpha_signals/);
  });
});
