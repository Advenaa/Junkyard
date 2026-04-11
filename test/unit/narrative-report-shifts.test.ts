/**
 * Structural regression tests for report-level narrative shifts (Cycle 340).
 *
 * Verifies:
 * - MarketReportLLMSchema includes narrativeShifts
 * - daily/pulse prompts instruct the model to populate narrativeShifts from narrative context
 * - reports/:id exposes narrativeShifts from stored report bodies
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

describe('MarketReportLLMSchema includes narrativeShifts', () => {
  const schemas = readSrc('src/process/schemas.ts');

  it('has narrativeShifts field in MarketReportLLMSchema', () => {
    assert.match(schemas, /narrativeShifts\s*:\s*z\.array\((?:z\.string\(\)|nonEmptyText)\)/);
  });

  it('narrativeShifts has max 5 default empty', () => {
    assert.match(schemas, /narrativeShifts.*\.max\(5\)/);
    assert.match(schemas, /narrativeShifts.*\.default\(\[\]\)/);
  });
});

describe('Daily and pulse prompts mention narrativeShifts', () => {
  const synth = readSrc('src/process/synthesize.ts') + '\n' + readSrc('src/process/synthesis-context.ts');
  const pulse = readSrc('src/process/pulse.ts');

  it('daily prompt schema includes narrativeShifts', () => {
    assert.ok(synth.includes('"narrativeShifts"'));
  });

  it('daily narrative_context instructions mention narrativeShifts', () => {
    assert.match(synth, /<narrative_context>[\s\S]*narrativeShifts/);
  });

  it('pulse prompt schema includes narrativeShifts', () => {
    assert.ok(pulse.includes('"narrativeShifts"'));
  });

  it('pulse narrative_context instructions mention narrativeShifts', () => {
    assert.match(pulse, /<narrative_context>[\s\S]*narrativeShifts/);
  });
});

describe('reports/:id exposes narrativeShifts', () => {
  const server = readServerSource();

  it('extracts narrativeShifts from parsed report bodies', () => {
    assert.ok(server.includes('report.narrativeShifts'));
    assert.match(server, /parsed\.narrativeShifts\s*\?\?\s*parsed\.narrative_shifts/);
  });
});
