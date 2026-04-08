/**
 * Structural regression tests for unusual-activity report surfaces (Cycle 299).
 *
 * Verifies:
 * - MarketReportLLMSchema includes unusualActivity
 * - daily/pulse prompts mention unusualActivity and <unusual_activity>
 * - reports/:id exposes unusualActivity from stored report bodies
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

describe('MarketReportLLMSchema includes unusualActivity', () => {
  const schemas = readSrc('src/process/schemas.ts');

  it('has unusualActivity field in MarketReportLLMSchema', () => {
    assert.match(schemas, /unusualActivity\s*:\s*z\.array\((?:z\.string\(\)|nonEmptyText)\)/);
  });

  it('unusualActivity has max 5 default empty', () => {
    assert.match(schemas, /unusualActivity.*\.max\(5\)/);
    assert.match(schemas, /unusualActivity.*\.default\(\[\]\)/);
  });
});

describe('Daily and pulse prompts mention unusualActivity', () => {
  const synth = readSrc('src/process/synthesize.ts');
  const pulse = readSrc('src/process/pulse.ts');

  it('daily prompt schema includes unusualActivity', () => {
    assert.ok(synth.includes('"unusualActivity"'));
  });

  it('daily unusual-activity instructions mention the field', () => {
    assert.match(synth, /<unusual_activity>[\s\S]*unusualActivity/);
  });

  it('daily unusual-activity context can include duplicate-cluster metadata', () => {
    assert.ok(synth.includes('dup_cluster='));
    assert.ok(synth.includes('duplicateClusterSize'));
    assert.ok(synth.includes('low_relevance='));
    assert.ok(synth.includes('copy-paste cluster lines'));
  });

  it('pulse prompt schema includes unusualActivity', () => {
    assert.ok(pulse.includes('"unusualActivity"'));
  });

  it('pulse unusual-activity instructions mention the field', () => {
    assert.match(pulse, /<unusual_activity>[\s\S]*unusualActivity/);
  });

  it('pulse unusual-activity context can include duplicate-cluster metadata', () => {
    assert.ok(pulse.includes('dup_cluster='));
    assert.ok(pulse.includes('duplicateClusterSize'));
    assert.ok(pulse.includes('low_relevance='));
    assert.ok(pulse.includes('copy-paste cluster lines'));
  });
});

describe('reports/:id exposes unusualActivity', () => {
  const server = readSrc('src/server.ts');

  it('extracts unusualActivity from parsed report bodies', () => {
    assert.ok(server.includes('report.unusualActivity'));
    assert.match(server, /parsed\.unusualActivity\s*\?\?\s*parsed\.unusual_activity/);
  });
});
