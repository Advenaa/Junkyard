import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { DiscordRuntimeToken } from '../../src/discord-tokens.js';
import type { Logger } from '../../src/logger.js';
import { _internal as discordRestInternal, pollDiscordChannel } from '../../src/ingest/discord-rest.js';

const CHANNEL_ID = '123456789012345678';
const GUILD_ID = '987654321098765432';
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

interface DiscordMessageFixture {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: {
    username: string;
    bot?: boolean;
  };
  content: string;
  timestamp: string;
  type: number;
  attachments?: Array<{
    url: string;
    content_type?: string;
  }>;
  embeds?: Array<{
    description?: string;
  }>;
  referenced_message?: {
    content?: string;
  } | null;
}

let originalFetch: typeof discordRestInternal.fetch;

function makeToken(name: string): DiscordRuntimeToken {
  return {
    token: `discord-token-${name}`,
    source: 'env',
    tokenId: `token-${name}`,
    label: null,
    maskedToken: `discord-token-${name}`,
    proxyUrl: null,
    maskedProxy: null,
  };
}

function makeLogger() {
  const log = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
    fatal: mock.fn(),
    child: mock.fn(),
  };

  return log as Logger & typeof log;
}

function makeMessage(overrides: Partial<DiscordMessageFixture> = {}): DiscordMessageFixture {
  return {
    id: '100',
    channel_id: CHANNEL_ID,
    guild_id: GUILD_ID,
    author: { username: 'alice' },
    content: 'hello from discord',
    timestamp: '2026-04-08T10:00:00.000Z',
    type: 0,
    attachments: [],
    embeds: [],
    referenced_message: null,
    ...overrides,
  };
}

function makeJsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function getFetchUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof input === 'object' && input !== null && 'url' in input && typeof input.url === 'string') {
    return input.url;
  }
  throw new Error(`Unsupported fetch input: ${String(input)}`);
}

function installFetchSequence(responses: Response[]) {
  const urls: string[] = [];
  const queue = [...responses];

  const fetchMock = mock.fn(async (input: unknown) => {
    const url = getFetchUrl(input);
    urls.push(url);
    const response = queue.shift();
    assert.ok(response, `unexpected fetch call for ${url}`);
    return response;
  });

  discordRestInternal.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return { fetchMock, urls };
}

function makePage(startId: number, count: number): DiscordMessageFixture[] {
  return Array.from({ length: count }, (_, index) => {
    const id = String(startId - index);
    return makeMessage({
      id,
      content: `message ${id}`,
      timestamp: `2026-04-08T10:${String(index).padStart(2, '0')}:00.000Z`,
    });
  });
}

describe('pollDiscordChannel', () => {
  beforeEach(() => {
    originalFetch = discordRestInternal.fetch;
  });

  afterEach(() => {
    discordRestInternal.fetch = originalFetch;
  });

  it('maps a fetched Discord message to RawItem fields', async () => {
    const log = makeLogger();
    const token = makeToken('primary');

    installFetchSequence([
      makeJsonResponse([
        makeMessage({
          id: '200',
          author: { username: 'marketwatch' },
          content: 'BTC broke resistance',
          timestamp: '2026-04-08T01:02:03.000Z',
        }),
      ]),
    ]);

    const result = await pollDiscordChannel(CHANNEL_ID, null, [token], log);

    assert.equal(result.fetchFailed, false);
    assert.strictEqual(result.usedToken, token);
    assert.equal(result.lastId, '200');
    assert.equal(result.items.length, 1);

    const item = result.items[0]!;
    assert.match(item.id, ULID_RE);
    assert.equal(item.source, 'discord');
    assert.equal(item.sourceId, CHANNEL_ID);
    assert.equal(item.author, 'marketwatch');
    assert.equal(item.content, 'BTC broke resistance');
    assert.equal(item.timestamp, new Date('2026-04-08T01:02:03.000Z').getTime());
    assert.equal(item.engagement, 0);
    assert.equal(item.attachments, undefined);
    assert.deepEqual(item.metadata, {
      guildId: GUILD_ID,
      messageId: '200',
      imageUrls: [],
    });
  });

  it('filters out bot-authored messages', async () => {
    const log = makeLogger();
    const token = makeToken('primary');

    installFetchSequence([
      makeJsonResponse([
        makeMessage({
          id: '101',
          author: { username: 'alert-bot', bot: true },
          content: 'bot message',
        }),
        makeMessage({
          id: '102',
          author: { username: 'human-trader' },
          content: 'real signal',
        }),
      ]),
    ]);

    const result = await pollDiscordChannel(CHANNEL_ID, null, [token], log);

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]!.author, 'human-trader');
    assert.equal(String(result.items[0]!.metadata['messageId']), '102');
  });

  it('filters out unsupported Discord message types', async () => {
    const log = makeLogger();
    const token = makeToken('primary');

    installFetchSequence([
      makeJsonResponse([
        makeMessage({ id: '101', type: 0, content: 'default message' }),
        makeMessage({ id: '102', type: 1, content: 'recipient add' }),
        makeMessage({ id: '103', type: 19, content: 'reply message' }),
        makeMessage({ id: '104', type: 20, content: 'application command' }),
      ]),
    ]);

    const result = await pollDiscordChannel(CHANNEL_ID, null, [token], log);

    assert.deepEqual(
      result.items.map((item) => String(item.metadata['messageId'])),
      ['101', '103'],
    );
  });

  it('assembles reply context, main content, and embed descriptions into one payload', async () => {
    const log = makeLogger();
    const token = makeToken('primary');
    const replyContent = 'r'.repeat(250);

    installFetchSequence([
      makeJsonResponse([
        makeMessage({
          id: '220',
          type: 19,
          content: 'Main analysis',
          referenced_message: { content: replyContent },
          embeds: [{ description: 'Embed alpha' }, {}, { description: 'Embed beta' }],
        }),
      ]),
    ]);

    const result = await pollDiscordChannel(CHANNEL_ID, null, [token], log);

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]!.content, `> ${replyContent.slice(0, 200)}\nMain analysis\nEmbed alpha\nEmbed beta`);
  });

  it('skips messages that have no content, no reply context, and no embeds', async () => {
    const log = makeLogger();
    const token = makeToken('primary');

    installFetchSequence([
      makeJsonResponse([
        makeMessage({
          id: '300',
          content: '',
          embeds: [],
          referenced_message: null,
        }),
      ]),
    ]);

    const result = await pollDiscordChannel(CHANNEL_ID, null, [token], log);

    assert.deepEqual(result.items, []);
    assert.equal(result.lastId, '300');
  });

  it('keeps only validated Discord CDN attachments and image URLs', async () => {
    const log = makeLogger();
    const token = makeToken('primary');
    const imageUrl = 'https://cdn.discordapp.com/attachments/1/2/chart.png';
    const fileUrl = 'https://media.discordapp.net/attachments/1/2/report.txt';

    installFetchSequence([
      makeJsonResponse([
        makeMessage({
          id: '400',
          attachments: [
            { url: imageUrl, content_type: 'image/png' },
            { url: fileUrl, content_type: 'text/plain' },
            { url: 'https://evil.example.com/attachments/1/2/chart.png', content_type: 'image/png' },
          ],
        }),
      ]),
    ]);

    const result = await pollDiscordChannel(CHANNEL_ID, null, [token], log);

    assert.equal(result.items.length, 1);
    assert.deepEqual(result.items[0]!.attachments, [imageUrl, fileUrl]);
    assert.deepEqual(result.items[0]!.metadata['imageUrls'], [imageUrl]);
  });

  it('returns fetchFailed=true and preserves lastId when every token fails', async () => {
    const log = makeLogger();
    const tokens = [makeToken('one'), makeToken('two')];
    const { urls } = installFetchSequence([
      makeJsonResponse({ error: 'bad' }, 500),
      makeJsonResponse({ error: 'bad' }, 503),
    ]);

    const result = await pollDiscordChannel(CHANNEL_ID, '999', tokens, log);

    assert.equal(result.fetchFailed, true);
    assert.equal(result.lastId, '999');
    assert.strictEqual(result.usedToken, null);
    assert.deepEqual(result.items, []);
    assert.equal(urls.length, 2);
    assert.ok(urls.every((url) => url.endsWith(`/channels/${CHANNEL_ID}/messages?limit=50&after=999`)));
  });

  it('returns an empty successful result when the channel has no new messages', async () => {
    const log = makeLogger();
    const token = makeToken('primary');

    installFetchSequence([makeJsonResponse([])]);

    const result = await pollDiscordChannel(CHANNEL_ID, '555', [token], log);

    assert.equal(result.fetchFailed, false);
    assert.strictEqual(result.usedToken, token);
    assert.deepEqual(result.items, []);
    assert.equal(result.lastId, '555');
  });

  it('paginates when the first page is full and stops when the next page is short', async () => {
    const log = makeLogger();
    const token = makeToken('primary');
    const { urls } = installFetchSequence([makeJsonResponse(makePage(150, 50)), makeJsonResponse(makePage(152, 2))]);

    const result = await pollDiscordChannel(CHANNEL_ID, '100', [token], log);

    assert.equal(urls.length, 2);
    assert.ok(urls[0]!.endsWith(`/channels/${CHANNEL_ID}/messages?limit=50&after=100`));
    assert.ok(urls[1]!.endsWith(`/channels/${CHANNEL_ID}/messages?limit=50&after=150`));
    assert.equal(result.items.length, 52);
    assert.equal(result.lastId, '152');
  });

  it('tracks the newest snowflake id as lastId even when the API returns newest-first', async () => {
    const log = makeLogger();
    const token = makeToken('primary');

    installFetchSequence([
      makeJsonResponse([
        makeMessage({ id: '300', content: 'newest' }),
        makeMessage({ id: '250', content: 'middle' }),
        makeMessage({ id: '200', content: 'oldest' }),
      ]),
    ]);

    const result = await pollDiscordChannel(CHANNEL_ID, null, [token], log);

    assert.equal(result.lastId, '300');
    assert.deepEqual(
      result.items.map((item) => String(item.metadata['messageId'])),
      ['200', '250', '300'],
    );
  });
});
