import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../src/process/correlate.ts', import.meta.url), 'utf-8');

describe('CO-010 — Flash trigger requires breaking urgency only + weightedSum >= 2.0', () => {
  it('flash trigger condition does NOT contain elevated', () => {
    // Extract the flash trigger block (the if-statement before shouldFlash = true)
    const flashBlock = src.slice(
      src.indexOf('// Flash trigger'),
      src.indexOf('shouldFlash = true') + 'shouldFlash = true'.length,
    );
    assert.ok(flashBlock.length > 0, 'Flash trigger block must exist');
    assert.ok(
      !flashBlock.includes("'elevated'"),
      `Flash trigger must not reference 'elevated', found: ${flashBlock}`,
    );
  });

  it('flash trigger uses >= 2.0 threshold (not >= 1.5)', () => {
    const flashBlock = src.slice(
      src.indexOf('// Flash trigger'),
      src.indexOf('shouldFlash = true') + 'shouldFlash = true'.length,
    );
    assert.match(flashBlock, />= 2(\.0)?/, 'Threshold must be >= 2 or >= 2.0');
    assert.ok(
      !flashBlock.includes('>= 1.5'),
      'Old threshold >= 1.5 must not be present',
    );
  });

  it("flash trigger checks entityUrgency === 'breaking'", () => {
    const flashBlock = src.slice(
      src.indexOf('// Flash trigger'),
      src.indexOf('shouldFlash = true') + 'shouldFlash = true'.length,
    );
    assert.match(
      flashBlock,
      /entityUrgency === 'breaking'/,
      "Flash trigger must check entityUrgency === 'breaking'",
    );
  });

  it('shouldFlash = true is preceded by the breaking check', () => {
    const flashIdx = src.indexOf('shouldFlash = true');
    assert.ok(flashIdx > 0, 'shouldFlash = true must exist in source');

    // Look at the 300 chars before shouldFlash = true for the breaking condition
    const preceding = src.slice(Math.max(0, flashIdx - 300), flashIdx);
    assert.match(
      preceding,
      /entityUrgency === 'breaking'/,
      "The breaking check must appear before shouldFlash = true",
    );
    assert.ok(
      !preceding.includes("entityUrgency === 'elevated'"),
      "No elevated check should precede shouldFlash = true",
    );
  });

  it('no elevated string appears anywhere in the flash trigger block', () => {
    // Broader check: from "Flash trigger" comment to the log.info after shouldFlash
    const startIdx = src.indexOf('// Flash trigger');
    const endIdx = src.indexOf('Flash trigger activated');
    assert.ok(startIdx > 0 && endIdx > startIdx, 'Flash trigger block boundaries must exist');

    const fullBlock = src.slice(startIdx, endIdx);
    assert.ok(
      !fullBlock.includes('elevated'),
      `The word 'elevated' must not appear in the flash trigger block`,
    );
  });
});
