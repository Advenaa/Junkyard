/**
 * Structural regression tests for Cross-Market Correlation 3.3 foundation (Cycle 287).
 *
 * Verifies:
 * - Migration 30 creates macro_snapshots and Migration 31 expands supported indicators
 * - Config includes fredApiKey
 * - FRED fetcher module exports the expected foundation
 * - Macro snapshot queries and tracker wiring exist
 * - Daily/pulse prompts mention <macro_context>
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

describe('Macro correlation migration (src/db/migrations.ts)', () => {
  const src = readSrc('src/db/migrations.ts');

  it('creates macro_snapshots table', () => {
    assert.match(src, /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?macro_snapshots\s*\(/i);
  });

  it('initially restricts indicators to vix, dxy, us10y, and spx', () => {
    assert.match(src, /indicator\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(indicator IN \('vix', 'dxy', 'us10y', 'spx'\)\)/i);
  });

  it('expands indicators to include gold in a follow-up migration', () => {
    assert.match(src, /Migration 31: Expand macro_snapshots indicators to include gold/i);
    assert.match(src, /CHECK \(indicator IN \('vix', 'dxy', 'us10y', 'spx', 'gold'\)\)/i);
  });

  it('has a unique index on indicator and date', () => {
    assert.match(src, /idx_macro_snapshots_indicator_date/i);
  });
});

describe('Config: fredApiKey', () => {
  const config = readSrc('src/config.ts');

  it('Config interface includes fredApiKey', () => {
    assert.match(config, /fredApiKey\s*:\s*string\s*\|\s*null/);
  });

  it('loadConfig reads FRED_API_KEY from env', () => {
    assert.match(config, /process\.env\[['"]FRED_API_KEY['"]\]/);
  });

  it('fredApiKey is part of the secrets array', () => {
    assert.ok(config.includes('fredApiKey'));
  });
});

describe('FRED fetcher module (src/macro/fred.ts)', () => {
  const src = readSrc('src/macro/fred.ts');

  it('exports createFredMacroFetcher', () => {
    assert.match(src, /export\s+function\s+createFredMacroFetcher/);
  });

  it('tracks VIX, broad dollar, US 10Y, S&P 500, and gold series IDs', () => {
    assert.ok(src.includes('VIXCLS'));
    assert.ok(src.includes('DTWEXBGS'));
    assert.ok(src.includes('DGS10'));
    assert.ok(src.includes('SP500'));
    assert.ok(src.includes('GOLDAMGBD228NLBM'));
  });

  it('calls the FRED series observations endpoint', () => {
    assert.ok(src.includes('series/observations'));
  });

  it('supports Authorization bearer auth', () => {
    assert.match(src, /Authorization:\s*`Bearer/);
  });
});

describe('Macro snapshot queries (src/db/queries.ts)', () => {
  const src = readSrc('src/db/queries.ts');

  it('exports MacroSnapshotRow', () => {
    assert.match(src, /export\s+interface\s+MacroSnapshotRow/);
  });

  it('exports upsertMacroSnapshots', () => {
    assert.match(src, /export\s+async\s+function\s+upsertMacroSnapshots/);
  });

  it('exports getLatestMacroSnapshots', () => {
    assert.match(src, /export\s+async\s+function\s+getLatestMacroSnapshots/);
  });
});

describe('Macro tracker integration', () => {
  const tracker = readSrc('src/macro/tracker.ts');
  const index = readSrc('src/index.ts');

  it('tracker exports createMacroTracker and fetchAndStore', () => {
    assert.match(tracker, /export\s+function\s+createMacroTracker/);
    assert.ok(tracker.includes('fetchAndStore'));
  });

  it('tracker uses createFredMacroFetcher and upsertMacroSnapshots', () => {
    assert.ok(tracker.includes('createFredMacroFetcher'));
    assert.ok(tracker.includes('upsertMacroSnapshots'));
  });

  it('index wires macroTracker into onDaily', () => {
    assert.match(index, /createMacroTracker\s*\(\s*pool\s*,\s*log\s*,\s*config\.fredApiKey/);
    assert.match(index, /macroTracker\.fetchAndStore\s*\(\s*\)/);
  });
});

describe('Macro prompt context', () => {
  const synth = readSrc('src/process/synthesize.ts');
  const pulse = readSrc('src/process/pulse.ts');

  it('daily synthesis prompt mentions macro_context', () => {
    assert.match(synth, /When <macro_context> data is provided/);
    assert.ok(synth.includes('<macro_context>'));
  });

  it('pulse prompt mentions macro_context', () => {
    assert.match(pulse, /When <macro_context> data is provided/);
    assert.ok(pulse.includes('<macro_context>'));
  });
});
