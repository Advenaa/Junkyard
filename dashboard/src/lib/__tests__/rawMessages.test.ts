import { describe, expect, it } from 'vitest';
import {
  buildRawMessageFooterMeta,
  formatAbsoluteDateTime,
  formatRelativeTime,
  normalizeRawMessageAttachments,
  unescapeMarkdownPunctuation,
} from '../rawMessages';

describe('unescapeMarkdownPunctuation', () => {
  it('returns clean content unchanged when there are no backslashes', () => {
    expect(unescapeMarkdownPunctuation('hello world')).toBe('hello world');
    expect(unescapeMarkdownPunctuation('')).toBe('');
  });

  it('strips backslashes preceding markdown punctuation', () => {
    const cases: Array<[string, string]> = [
      ['price moved 0\\.5%', 'price moved 0.5%'],
      ['ETH \\(layer 1\\)', 'ETH (layer 1)'],
      ['see \\[link\\]', 'see [link]'],
      ['bold \\*\\*token\\*\\*', 'bold **token**'],
      ['underscore \\_var\\_', 'underscore _var_'],
      ['strike \\~\\~old\\~\\~', 'strike ~~old~~'],
      ['code \\`fn\\`', 'code `fn`'],
      ['quote \\> reply', 'quote > reply'],
      ['heading \\#cabal', 'heading #cabal'],
      ['shout \\!alert', 'shout !alert'],
      ['list \\- item', 'list - item'],
      ['math 1\\+2\\=3', 'math 1+2=3'],
      ['braces \\{a\\}', 'braces {a}'],
      ['pipe a\\|b', 'pipe a|b'],
    ];

    for (const [input, expected] of cases) {
      expect(unescapeMarkdownPunctuation(input)).toBe(expected);
    }
  });

  it('does not touch backslashes that precede non-punctuation', () => {
    expect(unescapeMarkdownPunctuation('path C:\\users\\foo')).toBe('path C:\\users\\foo');
    expect(unescapeMarkdownPunctuation('newline marker \\n stays')).toBe('newline marker \\n stays');
  });

  it('handles mixed escaped and clean punctuation in one message', () => {
    const input = 'Just bought 0\\.5 ETH at \\$2,000 \\(big move\\)\\!';
    expect(unescapeMarkdownPunctuation(input)).toBe('Just bought 0.5 ETH at \\$2,000 (big move)!');
  });
});

describe('normalizeRawMessageAttachments', () => {
  it('passes arrays through unchanged', () => {
    expect(normalizeRawMessageAttachments(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('parses JSON strings into arrays', () => {
    expect(normalizeRawMessageAttachments('["a","b"]')).toEqual(['a', 'b']);
  });

  it('returns an empty array for null or invalid JSON', () => {
    expect(normalizeRawMessageAttachments(null)).toEqual([]);
    expect(normalizeRawMessageAttachments('not json')).toEqual([]);
  });
});

describe('formatRelativeTime', () => {
  it('returns "Just now" for sub-minute timestamps', () => {
    expect(formatRelativeTime(Date.now() - 5_000)).toBe('Just now');
  });

  it('returns minutes for sub-hour timestamps', () => {
    expect(formatRelativeTime(Date.now() - 5 * 60_000)).toBe('5m ago');
  });

  it('returns hours for sub-day timestamps', () => {
    expect(formatRelativeTime(Date.now() - 3 * 60 * 60_000)).toBe('3h ago');
  });

  it('returns days for older timestamps', () => {
    expect(formatRelativeTime(Date.now() - 2 * 24 * 60 * 60_000)).toBe('2d ago');
  });
});

describe('formatAbsoluteDateTime', () => {
  it('returns a non-empty locale string for a valid epoch', () => {
    const result = formatAbsoluteDateTime(Date.UTC(2026, 0, 15, 12, 0));
    expect(result).toMatch(/2026/);
  });
});

describe('buildRawMessageFooterMeta', () => {
  it('returns undefined when nothing to show', () => {
    expect(buildRawMessageFooterMeta({ attachments: [] })).toBeUndefined();
  });

  it('joins attachment, translation, language, and filter parts with pipes', () => {
    expect(
      buildRawMessageFooterMeta({
        attachments: ['a', 'b'],
        translated: true,
        originalLanguage: 'ind',
        filterReason: 'spam',
      }),
    ).toBe('2 attachments | Translated to English | language ind | filter spam');
  });

  it('singularizes attachment count', () => {
    expect(buildRawMessageFooterMeta({ attachments: ['a'] })).toBe('1 attachment');
  });
});
