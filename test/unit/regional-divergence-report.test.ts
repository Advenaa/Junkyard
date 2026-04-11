/**
 * Structural regression tests for report-level regional divergence (Cycle 353).
 *
 * Verifies:
 * - MarketReportLLMSchema includes regionalDivergence
 * - daily/pulse prompts instruct the model to populate regionalDivergence from regional divergence context
 * - reports/:id exposes regionalDivergence from stored report bodies
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

describe('MarketReportLLMSchema includes regionalDivergence', () => {
  const schemas = readSrc('src/process/schemas.ts');

  it('has regionalDivergence field in MarketReportLLMSchema', () => {
    assert.match(schemas, /regionalDivergence\s*:\s*z\.array\((?:z\.string\(\)|nonEmptyText)\)/);
  });

  it('regionalDivergence has max 5 default empty', () => {
    assert.match(schemas, /regionalDivergence.*\.max\(5\)/);
    assert.match(schemas, /regionalDivergence.*\.default\(\[\]\)/);
  });
});

describe('Daily and pulse prompts mention regionalDivergence', () => {
  const synth = readSrc('src/process/synthesize.ts');
  const pulse = readSrc('src/process/pulse.ts');

  it('daily prompt schema includes regionalDivergence', () => {
    assert.ok(synth.includes('"regionalDivergence"'));
  });

  it('daily regional_divergence instructions mention regionalDivergence', () => {
    assert.match(synth, /<regional_divergence>[\s\S]*regionalDivergence/);
  });

  it('pulse prompt schema includes regionalDivergence', () => {
    assert.ok(pulse.includes('"regionalDivergence"'));
  });

  it('pulse regional_divergence instructions mention regionalDivergence', () => {
    assert.match(pulse, /<regional_divergence>[\s\S]*regionalDivergence/);
  });
});

describe('reports/:id exposes regionalDivergence', () => {
  const server = readServerSource();

  it('extracts regionalDivergence from parsed report bodies', () => {
    assert.ok(server.includes('report.regionalDivergence'));
    assert.match(server, /parsed\.regionalDivergence\s*\?\?\s*parsed\.regional_divergence/);
  });
});
