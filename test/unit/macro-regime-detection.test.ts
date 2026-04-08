/**
 * Structural regression tests for Macro Regime Detection 3.4 foundation.
 *
 * Verifies:
 * - MarketReportLLMSchema includes macroRegime
 * - daily/pulse prompts instruct the model to populate macroRegime from macro_context
 * - reports/:id exposes macroRegime from stored report bodies
 * - webhook delivery can render a Macro Regime field
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

describe('MarketReportLLMSchema includes macroRegime', () => {
  const schemas = readSrc('src/process/schemas.ts');

  it('has macroRegime field in MarketReportLLMSchema', () => {
    assert.match(schemas, /macroRegime\s*:\s*MacroRegimeLLMSchema\.nullable\(\)\.default\(null\)/);
  });

  it('MacroRegimeLLMSchema enumerates supported classifications', () => {
    assert.match(schemas, /z\.enum\(\['risk-on', 'risk-off', 'transition', 'unclear'\]\)/);
  });
});

describe('Daily and pulse prompts mention macroRegime', () => {
  const synth = readSrc('src/process/synthesize.ts');
  const pulse = readSrc('src/process/pulse.ts');

  it('daily prompt schema includes macroRegime', () => {
    assert.ok(synth.includes('"macroRegime"'));
  });

  it('daily macro_context instructions mention macroRegime', () => {
    assert.match(synth, /<macro_context>[\s\S]*macroRegime/);
  });

  it('pulse prompt schema includes macroRegime', () => {
    assert.ok(pulse.includes('"macroRegime"'));
  });

  it('pulse macro_context instructions mention macroRegime', () => {
    assert.match(pulse, /<macro_context>[\s\S]*macroRegime/);
  });
});

describe('reports/:id exposes macroRegime', () => {
  const server = readSrc('src/server.ts');

  it('extracts macroRegime from parsed report bodies', () => {
    assert.ok(server.includes('report.macroRegime'));
    assert.match(server, /extractMacroRegime\(parsed\.macroRegime\s*\?\?\s*parsed\.macro_regime\)/);
  });
});

describe('webhook delivery includes macro regime field support', () => {
  const webhook = readSrc('src/deliver/webhook.ts');

  it('buildFields checks parsed.macroRegime', () => {
    assert.ok(webhook.includes('parsed.macroRegime'));
    assert.ok(webhook.includes("name: 'Macro Regime'"));
  });
});
