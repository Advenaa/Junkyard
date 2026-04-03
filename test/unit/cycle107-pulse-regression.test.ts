/**
 * Structural regression tests for cycle 107 finding SY-008:
 * Pulse now includes momentum + divergence context.
 *
 * createPulse accepts sentimentTracker and divergenceTracker,
 * buildUserMessage renders <sentiment_momentum> and <regional_divergence> XML blocks.
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

const src = readSrc('src/process/pulse.ts');

// ===========================================================================
// SY-008: Pulse includes momentum + divergence context
// ===========================================================================

describe('SY-008: createPulse accepts sentiment and divergence trackers', () => {
  it('createPulse signature includes sentimentTracker param', () => {
    assert.match(
      src,
      /export\s+function\s+createPulse\s*\([^)]*sentimentTracker\s*:\s*SentimentTracker/,
      'createPulse must accept sentimentTracker parameter',
    );
  });

  it('createPulse signature includes divergenceTracker param', () => {
    assert.match(
      src,
      /export\s+function\s+createPulse\s*\([^)]*divergenceTracker\s*:\s*DivergenceTracker/,
      'createPulse must accept divergenceTracker parameter',
    );
  });
});

describe('SY-008: SentimentTracker and DivergenceTracker interfaces', () => {
  it('SentimentTracker interface defines getMomentumContext method', () => {
    assert.match(
      src,
      /interface\s+SentimentTracker\s*\{[^}]*getMomentumContext/s,
      'SentimentTracker interface must define getMomentumContext method',
    );
  });

  it('DivergenceTracker interface defines getDivergence method', () => {
    assert.match(
      src,
      /interface\s+DivergenceTracker\s*\{[^}]*getDivergence/s,
      'DivergenceTracker interface must define getDivergence method',
    );
  });
});

describe('SY-008: buildUserMessage accepts momentum and divergence params', () => {
  it('buildUserMessage signature includes momentum param typed MomentumEntry[]', () => {
    assert.match(
      src,
      /function\s+buildUserMessage\s*\([^)]*momentum\s*:\s*MomentumEntry\[\]/,
      'buildUserMessage must accept momentum: MomentumEntry[] parameter',
    );
  });

  it('buildUserMessage signature includes divergence param typed DivergenceEntry[]', () => {
    assert.match(
      src,
      /function\s+buildUserMessage\s*\([^)]*divergence\s*:\s*DivergenceEntry\[\]/,
      'buildUserMessage must accept divergence: DivergenceEntry[] parameter',
    );
  });
});

describe('SY-008: sentiment_momentum XML block rendering', () => {
  it('source contains <sentiment_momentum> XML tag', () => {
    assert.ok(
      src.includes('<sentiment_momentum>'),
      'Source must contain <sentiment_momentum> opening tag',
    );
  });

  it('source contains </sentiment_momentum> closing XML tag', () => {
    assert.ok(
      src.includes('</sentiment_momentum>'),
      'Source must contain </sentiment_momentum> closing tag',
    );
  });

  it('momentum lines include avg= formatting', () => {
    assert.match(
      src,
      /avg=.*avgSentiment/,
      'Momentum line must format avg= with avgSentiment value',
    );
  });

  it('momentum lines include momentum= formatting', () => {
    assert.match(
      src,
      /momentum=.*momVal/,
      'Momentum line must format momentum= with momentum value',
    );
  });

  it('momentum lines include trend label', () => {
    assert.match(
      src,
      /\$\{m\.trend\}/,
      'Momentum line must include trend label from MomentumEntry',
    );
  });
});

describe('SY-008: regional_divergence XML block rendering', () => {
  it('source contains <regional_divergence> XML tag', () => {
    assert.ok(
      src.includes('<regional_divergence>'),
      'Source must contain <regional_divergence> opening tag',
    );
  });

  it('source contains </regional_divergence> closing XML tag', () => {
    assert.ok(
      src.includes('</regional_divergence>'),
      'Source must contain </regional_divergence> closing tag',
    );
  });

  it('divergence lines include EN sentiment= formatting', () => {
    assert.match(
      src,
      /EN sentiment=.*engSentiment/,
      'Divergence line must format EN sentiment= with engSentiment value',
    );
  });

  it('divergence lines include ID sentiment= formatting', () => {
    assert.match(
      src,
      /ID sentiment=.*indSentiment/,
      'Divergence line must format ID sentiment= with indSentiment value',
    );
  });

  it('divergence lines include divergence= formatting', () => {
    assert.match(
      src,
      /divergence=.*\.divergence/,
      'Divergence line must format divergence= with divergence value',
    );
  });
});

describe('SY-008: MomentumEntry and DivergenceEntry type imports', () => {
  it('imports MomentumEntry from ../knowledge/sentiment.js', () => {
    assert.match(
      src,
      /import\s+type\s*\{[^}]*MomentumEntry[^}]*\}\s*from\s*['"]\.\.\/knowledge\/sentiment\.js['"]/,
      'Must import MomentumEntry type from ../knowledge/sentiment.js',
    );
  });

  it('imports DivergenceEntry from ../knowledge/divergence.js', () => {
    assert.match(
      src,
      /import\s+type\s*\{[^}]*DivergenceEntry[^}]*\}\s*from\s*['"]\.\.\/knowledge\/divergence\.js['"]/,
      'Must import DivergenceEntry type from ../knowledge/divergence.js',
    );
  });
});
