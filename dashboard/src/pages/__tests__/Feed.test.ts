import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeFeedItem, formatTime } from '../Feed';

describe('normalizeFeedItem', () => {
  const base = {
    id: '1',
    source: 'discord',
    author: 'user1',
    content: 'hello',
    timestamp: '2026-01-01T00:00:00Z',
    engagement: null,
  };

  it('passes through array attachments', () => {
    const raw = { ...base, attachments: ['https://cdn.discordapp.com/a.png'] };
    const result = normalizeFeedItem(raw);
    expect(result.attachments).toEqual(['https://cdn.discordapp.com/a.png']);
  });

  it('parses JSON string attachments', () => {
    const raw = { ...base, attachments: '["https://cdn.discordapp.com/a.png"]' };
    const result = normalizeFeedItem(raw);
    expect(result.attachments).toEqual(['https://cdn.discordapp.com/a.png']);
  });

  it('returns empty array for invalid JSON string', () => {
    const raw = { ...base, attachments: 'not-json' };
    const result = normalizeFeedItem(raw);
    expect(result.attachments).toEqual([]);
  });

  it('returns empty array for null attachments', () => {
    const raw = { ...base, attachments: null };
    const result = normalizeFeedItem(raw);
    expect(result.attachments).toEqual([]);
  });

  it('preserves other fields unchanged', () => {
    const raw = { ...base, attachments: null };
    const result = normalizeFeedItem(raw);
    expect(result.id).toBe('1');
    expect(result.source).toBe('discord');
    expect(result.author).toBe('user1');
    expect(result.content).toBe('hello');
  });
});

describe('formatTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "Just now" for timestamps less than a minute ago', () => {
    const ts = new Date('2026-01-15T11:59:30Z').toISOString();
    expect(formatTime(ts)).toBe('Just now');
  });

  it('returns minutes ago for timestamps under an hour', () => {
    const ts = new Date('2026-01-15T11:45:00Z').toISOString();
    expect(formatTime(ts)).toBe('15m ago');
  });

  it('returns hours ago for timestamps under a day', () => {
    const ts = new Date('2026-01-15T09:00:00Z').toISOString();
    expect(formatTime(ts)).toBe('3h ago');
  });

  it('returns days ago for timestamps over a day', () => {
    const ts = new Date('2026-01-13T12:00:00Z').toISOString();
    expect(formatTime(ts)).toBe('2d ago');
  });

  it('returns 1m ago at exactly 60 seconds', () => {
    const ts = new Date('2026-01-15T11:59:00Z').toISOString();
    expect(formatTime(ts)).toBe('1m ago');
  });
});
