/**
 * Structural regression tests for Cross-Market Correlation 3.3 report alerts (Cycle 289).
 *
 * Verifies:
 * - MarketReportLLMSchema includes macroAlerts
 * - daily/pulse prompts instruct the model to populate macroAlerts from macro_context
 * - reports/:id exposes macroAlerts from stored report bodies
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

describe('MarketReportLLMSchema includes macroAlerts', () => {
  const schemas = readSrc('src/process/schemas.ts');

  it('has macroAlerts field in MarketReportLLMSchema', () => {
    assert.match(schemas, /macroAlerts\s*:\s*z\.array\((?:z\.string\(\)|nonEmptyText)\)/);
  });

  it('macroAlerts has max 5 default empty', () => {
    assert.match(schemas, /macroAlerts.*\.max\(5\)/);
    assert.match(schemas, /macroAlerts.*\.default\(\[\]\)/);
  });
});

describe('Daily and pulse prompts mention macroAlerts', () => {
  const synth = readSrc('src/process/synthesize.ts');
  const pulse = readSrc('src/process/pulse.ts');

  it('daily prompt schema includes macroAlerts', () => {
    assert.ok(synth.includes('"macroAlerts"'));
  });

  it('daily macro_context instructions mention macroAlerts', () => {
    assert.match(synth, /<macro_context>[\s\S]*macroAlerts/);
  });

  it('pulse prompt schema includes macroAlerts', () => {
    assert.ok(pulse.includes('"macroAlerts"'));
  });

  it('pulse macro_context instructions mention macroAlerts', () => {
    assert.match(pulse, /<macro_context>[\s\S]*macroAlerts/);
  });
});

describe('reports/:id exposes macroAlerts', () => {
  const server = readServerSource();

  it('extracts macroAlerts from parsed report bodies', () => {
    assert.ok(server.includes('report.macroAlerts'));
    assert.match(server, /parsed\.macroAlerts\s*\?\?\s*parsed\.macro_alerts/);
  });
});
