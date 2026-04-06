import { describe, expect, it } from 'vitest';
import { normalizeRawSourceItem } from '../rawSourceItems';

describe('rawSourceItems', () => {
  const base = {
    id: 'item-1',
    source: 'discord',
    sourceId: 'guild:1234',
    author: 'alice',
    content: 'hello',
    timestamp: Date.UTC(2026, 3, 6, 8, 0, 0),
    url: null,
    engagement: 0,
    originalLanguage: 'eng',
    translated: false,
    filterReason: null,
    status: 'processed',
    createdAt: Date.UTC(2026, 3, 6, 8, 1, 0),
  };

  it('parses JSON attachment strings into arrays', () => {
    const result = normalizeRawSourceItem({
      ...base,
      attachments: '["https://cdn.example.com/image.png"]',
    });
    expect(result.attachments).toEqual(['https://cdn.example.com/image.png']);
  });

  it('preserves attachment arrays', () => {
    const result = normalizeRawSourceItem({
      ...base,
      attachments: ['https://cdn.example.com/image.png'],
    });
    expect(result.attachments).toEqual(['https://cdn.example.com/image.png']);
  });

  it('falls back to an empty array for invalid attachment payloads', () => {
    const result = normalizeRawSourceItem({
      ...base,
      attachments: 'not-json',
    });
    expect(result.attachments).toEqual([]);
  });
});
