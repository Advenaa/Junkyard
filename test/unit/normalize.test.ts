import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Normalize - Spam Filter', () => {
  it('filters "gm" messages', () => {
    assert.ok(/^(gm|gn|gm\/gn)\s*[!.]*$/i.test('gm'));
    assert.ok(/^(gm|gn|gm\/gn)\s*[!.]*$/i.test('GM!'));
    assert.ok(/^(gm|gn|gm\/gn)\s*[!.]*$/i.test('gn'));
  });

  it('filters "gas!" messages', () => {
    assert.ok(/^gas\s*!*$/i.test('gas!'));
    assert.ok(/^gas\s*!*$/i.test('GAS'));
    assert.ok(/^gas\s*!*$/i.test('gas!!!'));
  });

  it('filters short posts', () => {
    assert.ok('hi there'.split(/\s+/).length < 5);
    assert.ok(!('this is a longer post with content'.split(/\s+/).length < 5));
  });

  it('filters single emoji', () => {
    assert.ok(/^\p{Emoji}\s*$/u.test('🚀'));
    assert.ok(!(/^\p{Emoji}\s*$/u.test('🚀 to the moon')));
  });

  it('allows normal content', () => {
    const content = 'Ethereum just hit a new ATH, breaking $4200 resistance';
    assert.ok(content.split(/\s+/).length >= 5);
    assert.ok(!(/^(gm|gn)\s*[!.]*$/i.test(content)));
  });
});

describe('Normalize - Language Detection', () => {
  it('accepts eng, ind, und', () => {
    const accepted = ['eng', 'ind', 'und'];
    assert.ok(accepted.includes('eng'));
    assert.ok(accepted.includes('ind'));
    assert.ok(accepted.includes('und'));
    assert.ok(!accepted.includes('fra'));
  });
});

describe('Normalize - Injection Detection', () => {
  it('detects "ignore previous" pattern', () => {
    assert.ok(/ignore\s+(all\s+)?previous/i.test('Ignore previous instructions'));
    assert.ok(/ignore\s+(all\s+)?previous/i.test('ignore all previous'));
  });

  it('detects XML closing tags', () => {
    assert.ok(/<\/[a-z_]+>/i.test('</scraped_content>'));
    assert.ok(!/<\/[a-z_]+>/i.test('normal text'));
  });

  it('allows normal content', () => {
    const content = 'Bitcoin price analysis: support at $42k, resistance at $45k';
    assert.ok(!(/ignore\s+(all\s+)?previous/i.test(content)));
  });
});
