/**
 * Structural regression tests for first-mover report surfaces (Cycle 306).
 *
 * Verifies:
 * - MarketReportLLMSchema includes firstMovers
 * - daily/pulse prompts mention firstMovers and <first_movers>
 * - reports/:id exposes firstMovers from stored report bodies
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

describe('MarketReportLLMSchema includes firstMovers', () => {
  const schemas = readSrc('src/process/schemas.ts');

  it('has firstMovers field in MarketReportLLMSchema', () => {
    assert.match(schemas, /firstMovers\s*:\s*z\.array\((?:z\.string\(\)|nonEmptyText)\)/);
  });

  it('firstMovers has max 5 default empty', () => {
    assert.match(schemas, /firstMovers.*\.max\(5\)/);
    assert.match(schemas, /firstMovers.*\.default\(\[\]\)/);
  });
});

describe('Daily and pulse prompts mention firstMovers', () => {
  const synth = readSrc('src/process/synthesize.ts');
  const pulse = readSrc('src/process/pulse.ts');

  it('daily prompt schema includes firstMovers', () => {
    assert.ok(synth.includes('"firstMovers"'));
  });

  it('daily first-mover instructions mention the field', () => {
    assert.match(synth, /<first_movers>[\s\S]*firstMovers/);
  });

  it('pulse prompt schema includes firstMovers', () => {
    assert.ok(pulse.includes('"firstMovers"'));
  });

  it('pulse first-mover instructions mention the field', () => {
    assert.match(pulse, /<first_movers>[\s\S]*firstMovers/);
  });
});

describe('reports/:id exposes firstMovers', () => {
  const server = readServerSource();

  it('extracts firstMovers from parsed report bodies', () => {
    assert.ok(server.includes('report.firstMovers'));
    assert.match(server, /parsed\.firstMovers\s*\?\?\s*parsed\.first_movers/);
  });
});
