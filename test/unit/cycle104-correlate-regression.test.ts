import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const correlateSrc = readFileSync(new URL('../../src/process/correlate.ts', import.meta.url), 'utf-8');
const indexSrc = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf-8');

// ── CO-001 — Trust weight per (source, source_id) ──────────────────────────

describe('CO-001 — Trust weight queried per (source, source_id) pair', () => {
  it('trust weight SQL uses (source, source_id) IN tuple matching', () => {
    assert.match(
      correlateSrc,
      /\(source, source_id\) IN/,
      'Trust weight query must use (source, source_id) IN tuple syntax',
    );
  });

  it('trust weight SQL does NOT use source = ANY', () => {
    // Extract the trust weight query block
    const trustBlock = correlateSrc.slice(
      correlateSrc.indexOf('// CO-001'),
      correlateSrc.indexOf('const trustMap'),
    );
    assert.ok(trustBlock.length > 0, 'CO-001 trust weight block must exist');
    assert.ok(
      !trustBlock.includes('source = ANY'),
      'Trust weight query must not use source = ANY (old per-type pattern)',
    );
  });

  it('trustMap key format is source:source_id', () => {
    // The trustMap must be keyed by `${r.source}:${r.source_id}`
    assert.match(
      correlateSrc,
      /trustMap.*new Map\(trustRows\.map\(r => \[`\$\{r\.source\}:\$\{r\.source_id\}`/,
      'trustMap key must use `${r.source}:${r.source_id}` format',
    );
  });

  it('trust weight lookup uses source:sourceId composite key', () => {
    // The lookup in the per-entity loop must build a composite key
    assert.match(
      correlateSrc,
      /trustKey.*=.*`\$\{source\}:\$\{sourceId\}`/,
      'Trust lookup must use composite source:sourceId key',
    );
    assert.match(
      correlateSrc,
      /trustMap\.get\(trustKey\)/,
      'Trust lookup must call trustMap.get(trustKey)',
    );
  });

  it('sourcePairSet builds keys as source:source_id', () => {
    assert.match(
      correlateSrc,
      /sourcePairSet\.add\(`\$\{meta\.source\}:\$\{meta\.source_id\}`\)/,
      'sourcePairSet must build composite keys from meta.source and meta.source_id',
    );
  });
});

// ── CO-003 — json_agg runtime validation ────────────────────────────────────

describe('CO-003 — json_agg mentions runtime validation', () => {
  it('checks if mentions is a string and attempts JSON.parse', () => {
    assert.match(
      correlateSrc,
      /typeof mentions === 'string'/,
      'Must check if mentions is a string',
    );
    assert.match(
      correlateSrc,
      /JSON\.parse\(mentions\)/,
      'Must attempt JSON.parse on string mentions',
    );
  });

  it('checks Array.isArray(mentions) after parse', () => {
    assert.match(
      correlateSrc,
      /Array\.isArray\(mentions\)/,
      'Must validate mentions is an array via Array.isArray',
    );
  });

  it('skips rows with unparseable string mentions', () => {
    // The catch block after JSON.parse must continue (skip the row)
    const parseIdx = correlateSrc.indexOf('JSON.parse(mentions)');
    assert.ok(parseIdx > 0, 'JSON.parse(mentions) must exist');

    const afterParse = correlateSrc.slice(parseIdx, parseIdx + 300);
    assert.match(
      afterParse,
      /catch/,
      'Must have a catch block after JSON.parse',
    );
    assert.match(
      afterParse,
      /continue/,
      'Must continue (skip row) on parse failure',
    );
  });

  it('skips rows where mentions is not an array', () => {
    const arrayCheckIdx = correlateSrc.indexOf('!Array.isArray(mentions)');
    assert.ok(arrayCheckIdx > 0, '!Array.isArray(mentions) check must exist');

    const afterCheck = correlateSrc.slice(arrayCheckIdx, arrayCheckIdx + 200);
    assert.match(
      afterCheck,
      /continue/,
      'Must continue (skip row) when mentions is not an array',
    );
  });

  it('CO-003 comment marks the validation block', () => {
    assert.match(
      correlateSrc,
      /CO-003.*Runtime validation/i,
      'CO-003 comment must mark the validation block',
    );
  });
});

// ── CO-006 — Flash trigger cutoff from poll ─────────────────────────────────

describe('CO-006 — Flash trigger passes min_ts cutoff to correlator.run()', () => {
  it('correlator.run() in the summarizer loop receives a cutoff argument', () => {
    // Find the correlator.run call inside the summarizer loop (near hasBreaking)
    const breakingIdx = indexSrc.indexOf('result.hasBreaking');
    assert.ok(breakingIdx > 0, 'result.hasBreaking check must exist in index.ts');

    const blockAfterBreaking = indexSrc.slice(breakingIdx, breakingIdx + 300);
    assert.match(
      blockAfterBreaking,
      /correlator\.run\(row\.min_ts\)/,
      'correlator.run must be called with row.min_ts as cutoff',
    );
  });

  it('correlator.run() is NOT called with empty parens in the poll handler', () => {
    // Specifically in the poll handler context, correlator.run() should not be empty
    const breakingIdx = indexSrc.indexOf('result.hasBreaking');
    assert.ok(breakingIdx > 0);

    const blockAfterBreaking = indexSrc.slice(breakingIdx, breakingIdx + 300);
    assert.ok(
      !blockAfterBreaking.includes('correlator.run()'),
      'correlator.run() must not be called with empty parens in poll handler (would default to 24h)',
    );
  });

  it('run() accepts optional cutoff parameter', () => {
    assert.match(
      correlateSrc,
      /async function run\(cutoff\?.*\)/,
      'run() must accept an optional cutoff parameter',
    );
  });

  it('effectiveCutoff falls back to 24h when cutoff is undefined', () => {
    assert.match(
      correlateSrc,
      /cutoff \?\? \(Date\.now\(\) - 24 \* 60 \* 60 \* 1000\)/,
      'Must fallback to 24h window when no cutoff provided',
    );
  });
});
