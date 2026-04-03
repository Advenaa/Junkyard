import { describe, it, beforeEach, afterEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import RssParser from 'rss-parser';
import type { Logger } from '../../src/logger.js';

// ── Helpers ─────────────────────────────────────────────────────────

/** Reproduce syntheticGuid logic (private in rss.ts) for assertions */
function expectedGuid(pubDate: string | undefined, title: string | undefined): string {
  const input = `${pubDate ?? ''}${title ?? ''}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

const noopLog: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLog,
} as unknown as Logger;

function makeFeedItem(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Test Article',
    link: 'https://example.com/article-1',
    contentSnippet: 'This is a test article snippet that is long enough to skip extraction.',
    isoDate: new Date().toISOString(),
    creator: 'Test Author',
    categories: ['crypto', 'defi'],
    guid: undefined as string | undefined,
    ...overrides,
  };
}

function makeFeed(items: ReturnType<typeof makeFeedItem>[], title = 'Test Feed') {
  return { title, items };
}

// ── syntheticGuid ───────────────────────────────────────────────────

describe('syntheticGuid (via pollFeed metadata)', () => {
  it('is deterministic — same inputs produce same guid', () => {
    const a = expectedGuid('2026-01-01T00:00:00Z', 'Hello');
    const b = expectedGuid('2026-01-01T00:00:00Z', 'Hello');
    assert.equal(a, b);
  });

  it('different titles produce different guids', () => {
    const a = expectedGuid('2026-01-01T00:00:00Z', 'Title A');
    const b = expectedGuid('2026-01-01T00:00:00Z', 'Title B');
    assert.notEqual(a, b);
  });

  it('different dates produce different guids', () => {
    const a = expectedGuid('2026-01-01T00:00:00Z', 'Same Title');
    const b = expectedGuid('2026-02-01T00:00:00Z', 'Same Title');
    assert.notEqual(a, b);
  });

  it('handles undefined pubDate', () => {
    const guid = expectedGuid(undefined, 'Title Only');
    assert.equal(typeof guid, 'string');
    assert.equal(guid.length, 64); // sha256 hex
  });

  it('handles undefined title', () => {
    const guid = expectedGuid('2026-01-01T00:00:00Z', undefined);
    assert.equal(typeof guid, 'string');
    assert.equal(guid.length, 64);
  });

  it('handles both undefined — still produces valid hash', () => {
    const guid = expectedGuid(undefined, undefined);
    assert.equal(typeof guid, 'string');
    assert.equal(guid.length, 64);
    // Hash of empty string
    assert.equal(guid, crypto.createHash('sha256').update('').digest('hex'));
  });
});

// ── pollFeed ────────────────────────────────────────────────────────

describe('pollFeed', () => {
  let originalParseString: typeof RssParser.prototype.parseString;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalParseString = RssParser.prototype.parseString;
    originalFetch = globalThis.fetch;
    // Mock fetch for fetchValidated — return valid RSS XML response
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      text: async () => '<rss></rss>',
      headers: new Headers(),
    })) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    RssParser.prototype.parseString = originalParseString;
    globalThis.fetch = originalFetch;
  });

  // Lazy import so the mock is in place when the module runs
  async function loadPollFeed() {
    const mod = await import('../../src/ingest/rss.js');
    return mod.pollFeed;
  }

  it('parses a valid RSS feed and returns RawItems', async () => {
    const now = new Date();
    const item1 = makeFeedItem({
      title: 'Article One',
      link: 'https://example.com/1',
      contentSnippet: 'First article content that is definitely long enough to avoid extraction being triggered by the length check.',
      isoDate: now.toISOString(),
      creator: 'Alice',
      guid: 'guid-1',
      categories: ['news'],
    });
    const item2 = makeFeedItem({
      title: 'Article Two',
      link: 'https://example.com/2',
      contentSnippet: 'Second article content that is also long enough so we do not trigger the article extraction path in the code.',
      isoDate: new Date(now.getTime() + 1000).toISOString(),
      creator: 'Bob',
      guid: 'guid-2',
      categories: ['defi'],
    });

    RssParser.prototype.parseString = async function () {
      return makeFeed([item1, item2]);
    } as typeof RssParser.prototype.parseString;

    const pollFeed = await loadPollFeed();
    const result = await pollFeed('https://example.com/feed.xml', null, noopLog);

    assert.equal(result.items.length, 2);
    assert.equal(result.items[0]!.content, item1.contentSnippet);
    assert.equal(result.items[0]!.author, 'Alice');
    assert.equal(result.items[0]!.source, 'rss');
    assert.equal(result.items[0]!.sourceId, 'https://example.com/feed.xml');
    assert.equal(result.items[0]!.url, 'https://example.com/1');
    assert.equal(result.items[0]!.engagement, 0);

    assert.equal(result.items[1]!.content, item2.contentSnippet);
    assert.equal(result.items[1]!.author, 'Bob');

    // lastId should be the guid of the newest (last sorted) item
    assert.equal(result.lastId, 'guid-2');
  });

  it('returns empty items for an empty feed', async () => {
    RssParser.prototype.parseString = async function () {
      return makeFeed([]);
    } as typeof RssParser.prototype.parseString;

    const pollFeed = await loadPollFeed();
    const result = await pollFeed('https://example.com/feed.xml', null, noopLog);

    assert.equal(result.items.length, 0);
    assert.equal(result.lastId, null);
  });

  it('filters items before lastId by timestamp', async () => {
    const t1 = new Date('2026-04-03T10:00:00Z');
    const t2 = new Date('2026-04-03T11:00:00Z');
    const t3 = new Date('2026-04-03T12:00:00Z');

    const items = [
      makeFeedItem({
        title: 'Old',
        guid: 'g-old',
        isoDate: t1.toISOString(),
        contentSnippet: 'Old content padded to be long enough to avoid extraction. '.repeat(10),
      }),
      makeFeedItem({
        title: 'Seen',
        guid: 'g-seen',
        isoDate: t2.toISOString(),
        contentSnippet: 'Seen content padded to be long enough to avoid extraction. '.repeat(10),
      }),
      makeFeedItem({
        title: 'New',
        guid: 'g-new',
        isoDate: t3.toISOString(),
        contentSnippet: 'New content padded to be long enough to avoid extraction. '.repeat(10),
      }),
    ];

    RssParser.prototype.parseString = async function () {
      return makeFeed(items);
    } as typeof RssParser.prototype.parseString;

    const pollFeed = await loadPollFeed();
    const result = await pollFeed('https://example.com/feed.xml', 'g-seen', noopLog);

    // Only items newer than g-seen should be returned
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]!.content, items[2]!.contentSnippet);
    assert.equal(result.lastId, 'g-new');
  });

  it('returns all items when lastId is not found in feed', async () => {
    const now = new Date();
    const items = [
      makeFeedItem({
        title: 'Item A',
        guid: 'ga',
        isoDate: now.toISOString(),
        contentSnippet: 'Content A padded to be long enough to avoid extraction path. '.repeat(10),
      }),
      makeFeedItem({
        title: 'Item B',
        guid: 'gb',
        isoDate: new Date(now.getTime() + 1000).toISOString(),
        contentSnippet: 'Content B padded to be long enough to avoid extraction path. '.repeat(10),
      }),
    ];

    RssParser.prototype.parseString = async function () {
      return makeFeed(items);
    } as typeof RssParser.prototype.parseString;

    const pollFeed = await loadPollFeed();
    const result = await pollFeed('https://example.com/feed.xml', 'nonexistent-id', noopLog);

    assert.equal(result.items.length, 2);
  });

  it('handles fetch/parse error gracefully', async () => {
    globalThis.fetch = (async () => {
      throw new Error('Network error: ECONNREFUSED');
    }) as unknown as typeof globalThis.fetch;

    const errors: unknown[] = [];
    const errorLog: Logger = {
      ...noopLog,
      error: (...args: unknown[]) => { errors.push(args); },
    } as unknown as Logger;

    const pollFeed = await loadPollFeed();
    const result = await pollFeed('https://example.com/feed.xml', 'prev-id', errorLog);

    assert.equal(result.items.length, 0);
    assert.equal(result.lastId, 'prev-id'); // preserves previous lastId
    assert.ok(errors.length > 0, 'error should have been logged');
  });

  it('uses synthetic guid when item has no guid', async () => {
    const isoDate = '2026-04-03T10:00:00Z';
    const title = 'No GUID Article';

    const items = [
      makeFeedItem({
        title,
        guid: undefined, // no guid
        isoDate,
        contentSnippet: 'Content without guid, padded to avoid extraction. '.repeat(12),
      }),
    ];

    RssParser.prototype.parseString = async function () {
      return makeFeed(items);
    } as typeof RssParser.prototype.parseString;

    const pollFeed = await loadPollFeed();
    const result = await pollFeed('https://example.com/feed.xml', null, noopLog);

    assert.equal(result.items.length, 1);

    const meta = result.items[0]!.metadata as { guid: string };
    const expected = expectedGuid(isoDate, title);
    assert.equal(meta.guid, expected);
  });

  it('maps RSS fields to RawItem correctly', async () => {
    const isoDate = new Date().toISOString();
    const items = [
      makeFeedItem({
        title: 'Mapped Title',
        link: 'https://example.com/mapped',
        contentSnippet: 'The content snippet field should map to RawItem content. Padded for length. '.repeat(8),
        isoDate,
        creator: 'Mapper McMapface',
        guid: 'map-guid',
        categories: ['cat1', 'cat2'],
      }),
    ];

    RssParser.prototype.parseString = async function () {
      return makeFeed(items, 'My Feed Title');
    } as typeof RssParser.prototype.parseString;

    const pollFeed = await loadPollFeed();
    const result = await pollFeed('https://example.com/feed.xml', null, noopLog);

    const item = result.items[0]!;

    // Content comes from contentSnippet
    assert.equal(item.content, items[0]!.contentSnippet);
    // Author comes from creator
    assert.equal(item.author, 'Mapper McMapface');
    // URL comes from link
    assert.equal(item.url, 'https://example.com/mapped');
    // Timestamp comes from isoDate
    assert.equal(item.timestamp, new Date(isoDate).getTime());
    // Source is always 'rss'
    assert.equal(item.source, 'rss');
    // Metadata includes feedTitle, categories, guid
    const meta = item.metadata as { feedTitle: string; categories: string[]; guid: string };
    assert.equal(meta.feedTitle, 'My Feed Title');
    assert.deepEqual(meta.categories, ['cat1', 'cat2']);
    assert.equal(meta.guid, 'map-guid');
    // id is a ULID (26 chars, uppercase alphanumeric)
    assert.match(item.id, /^[0-9A-Z]{26}$/);
  });

  it('sorts items by pubDate ascending', async () => {
    const items = [
      makeFeedItem({
        title: 'Third',
        guid: 'g3',
        isoDate: '2026-04-03T12:00:00Z',
        contentSnippet: 'Third item content padded to be long enough. '.repeat(12),
      }),
      makeFeedItem({
        title: 'First',
        guid: 'g1',
        isoDate: '2026-04-03T10:00:00Z',
        contentSnippet: 'First item content padded to be long enough. '.repeat(12),
      }),
      makeFeedItem({
        title: 'Second',
        guid: 'g2',
        isoDate: '2026-04-03T11:00:00Z',
        contentSnippet: 'Second item content padded to be long enough. '.repeat(12),
      }),
    ];

    RssParser.prototype.parseString = async function () {
      return makeFeed(items);
    } as typeof RssParser.prototype.parseString;

    const pollFeed = await loadPollFeed();
    const result = await pollFeed('https://example.com/feed.xml', 'nonexistent', noopLog);

    assert.equal(result.items.length, 3);
    assert.ok(result.items[0]!.timestamp <= result.items[1]!.timestamp);
    assert.ok(result.items[1]!.timestamp <= result.items[2]!.timestamp);
  });

  it('falls back to feed title when creator is missing', async () => {
    const items = [
      makeFeedItem({
        title: 'No Author',
        guid: 'g-noauthor',
        isoDate: new Date().toISOString(),
        contentSnippet: 'Content with no author, padded long. '.repeat(15),
        creator: undefined,
      }),
    ];

    RssParser.prototype.parseString = async function () {
      return makeFeed(items, 'Fallback Feed Name');
    } as typeof RssParser.prototype.parseString;

    const pollFeed = await loadPollFeed();
    const result = await pollFeed('https://example.com/feed.xml', null, noopLog);

    assert.equal(result.items[0]!.author, 'Fallback Feed Name');
  });
});
