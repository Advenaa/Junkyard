import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';
import { ulid } from 'ulid';
import type { Logger } from '../logger.js';
import type { DiscordRuntimeToken } from '../discord-tokens.js';
import type { RawItem } from './rss.js';

// ---------------------------------------------------------------------------
// Types for Discord REST API responses
// ---------------------------------------------------------------------------

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: number; // 0=text, 2=voice, 4=category, 5=announcement, etc.
  position: number;
  parentId: string | null; // category ID
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DISCORD_API = 'https://discord.com/api/v10';

export const _internal = { fetch: undiciFetch as unknown as typeof globalThis.fetch };

// ---------------------------------------------------------------------------
// Internal raw types (snake_case from Discord API)
// ---------------------------------------------------------------------------

interface RawGuild {
  id: string;
  name: string;
  icon: string | null;
}

interface RawChannel {
  id: string;
  name: string;
  type: number;
  position: number;
  parent_id: string | null;
}

// ---------------------------------------------------------------------------
// Rate-limit-aware fetch helper
// ---------------------------------------------------------------------------

interface RestTokenRuntime {
  config: DiscordRuntimeToken;
  dispatcher: Dispatcher | null;
}

function buildRestTokenRuntime(tokens: DiscordRuntimeToken[]): RestTokenRuntime[] {
  return tokens.map((config) => ({
    config,
    dispatcher: config.proxyUrl ? new ProxyAgent(config.proxyUrl) : null,
  }));
}

function closeDispatchers(tokens: RestTokenRuntime[], log: Logger): void {
  for (const token of tokens) {
    if (!token.dispatcher) continue;
    void token.dispatcher.close().catch((err: unknown) => {
      log.warn({ err, tokenId: token.config.tokenId }, 'discord-rest: failed to close proxy dispatcher');
    });
  }
}

async function discordFetch<T>(path: string, token: RestTokenRuntime, log: Logger): Promise<T | null> {
  try {
    const response = await _internal.fetch(`${DISCORD_API}${path}`, {
      headers: {
        Authorization: token.config.token,
        'Content-Type': 'application/json',
      },
      dispatcher: token.dispatcher ?? undefined,
      signal: AbortSignal.timeout(10_000),
    } as RequestInit & { dispatcher?: Dispatcher });

    if (response.status === 401 || response.status === 403) {
      log.warn({ path, status: response.status }, 'discord-rest: token unauthorized');
      return null;
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      log.warn({ path, retryAfter }, 'discord-rest: rate limited');
      return null;
    }

    if (!response.ok) {
      log.warn({ path, status: response.status }, 'discord-rest: request failed');
      return null;
    }

    return (await response.json()) as T;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ path, err: msg }, 'discord-rest: fetch error');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDiscordRest(tokens: DiscordRuntimeToken[], log: Logger) {
  let activeTokens = buildRestTokenRuntime(tokens);

  /**
   * Fetch all guilds visible across all tokens, deduplicated by guild ID.
   * Returns guilds sorted by name.
   */
  async function getGuilds(): Promise<DiscordGuild[]> {
    const guildMap = new Map<string, DiscordGuild>();

    for (const token of activeTokens) {
      const guilds = await discordFetch<RawGuild[]>('/users/@me/guilds?limit=200', token, log);
      if (!guilds) continue;

      for (const g of guilds) {
        if (!guildMap.has(g.id)) {
          guildMap.set(g.id, {
            id: g.id,
            name: g.name,
            icon: g.icon,
          });
        }
      }
    }

    return [...guildMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Fetch channels for a guild. Uses the first token that has access.
   * Returns only text (0) and announcement (5) channels, sorted by position.
   */
  async function getChannels(guildId: string): Promise<DiscordChannel[]> {
    for (const token of activeTokens) {
      const channels = await discordFetch<RawChannel[]>(`/guilds/${guildId}/channels`, token, log);
      if (!channels) continue;

      // Filter to text-like channels only (type 0 = text, type 5 = announcement)
      return channels
        .filter((c) => c.type === 0 || c.type === 5)
        .map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          position: c.position,
          parentId: c.parent_id,
        }))
        .sort((a, b) => a.position - b.position);
    }

    return [];
  }

  function updateTokens(newTokens: DiscordRuntimeToken[]): void {
    closeDispatchers(activeTokens, log);
    activeTokens = buildRestTokenRuntime(newTokens);
  }

  return { getGuilds, getChannels, updateTokens };
}

// ---------------------------------------------------------------------------
// Discord REST message polling
// ---------------------------------------------------------------------------

const DISCORD_CDN_HOSTS: ReadonlySet<string> = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

function isValidDiscordUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && DISCORD_CDN_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function isImageUrl(url: string, contentType?: string): boolean {
  if (contentType?.startsWith('image/')) return true;
  try {
    const path = new URL(url).pathname.toLowerCase();
    return [...IMAGE_EXTENSIONS].some((ext) => path.endsWith(ext));
  } catch {
    return false;
  }
}

interface RawDiscordAuthor {
  username: string;
  bot?: boolean;
}

interface RawDiscordAttachment {
  url: string;
  content_type?: string;
}

interface RawDiscordEmbed {
  description?: string;
}

interface RawDiscordReferencedMessage {
  content?: string;
}

interface RawDiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: RawDiscordAuthor;
  content: string;
  timestamp: string;
  type: number;
  attachments?: RawDiscordAttachment[];
  embeds?: RawDiscordEmbed[];
  referenced_message?: RawDiscordReferencedMessage | null;
}

/**
 * Poll a Discord channel for recent messages via REST API.
 *
 * Uses `GET /channels/{channelId}/messages` with `after` for incremental fetching.
 * Maps messages to `RawItem` using the same logic as the gateway's `handleMessageCreate`.
 *
 * Returns the array of new RawItems and the latest message ID for state tracking.
 */
const PAGE_SIZE = 50;
const MAX_PAGES = 5; // Cap at 250 messages per poll to avoid runaway fetches

export async function pollDiscordChannel(
  channelId: string,
  lastId: string | null,
  tokens: DiscordRuntimeToken[],
  log: Logger,
): Promise<{ items: RawItem[]; lastId: string | null; usedToken: DiscordRuntimeToken | null; fetchFailed: boolean }> {
  const runtimeTokens = buildRestTokenRuntime(tokens);

  try {
    // Find a working token first
    let workingToken: RestTokenRuntime | null = null;
    let usedTokenConfig: DiscordRuntimeToken | null = null;

    // Test with initial fetch
    const currentAfter = lastId;
    let path = `/channels/${channelId}/messages?limit=${PAGE_SIZE}`;
    if (currentAfter) {
      path += `&after=${currentAfter}`;
    }

    let firstPage: RawDiscordMessage[] | null = null;
    for (const token of runtimeTokens) {
      firstPage = await discordFetch<RawDiscordMessage[]>(path, token, log);
      if (firstPage) {
        workingToken = token;
        usedTokenConfig = token.config;
        break;
      }
    }

    // All tokens failed — signal fetch failure so caller doesn't update last_fetched_at
    if (!workingToken) {
      log.warn({ channelId }, 'discord-rest: all tokens failed for channel');
      return { items: [], lastId, usedToken: null, fetchFailed: true };
    }

    // Successful fetch but no messages
    if (!firstPage || firstPage.length === 0) {
      return { items: [], lastId, usedToken: usedTokenConfig, fetchFailed: false };
    }

    // Collect all pages (paginate while Discord returns a full page)
    const allMessages: RawDiscordMessage[] = [...firstPage];
    let pageCount = 1;
    let lastPageSize = firstPage.length;

    while (lastPageSize === PAGE_SIZE && pageCount < MAX_PAGES) {
      const newestInPage = allMessages.reduce((a, b) => (BigInt(a.id) > BigInt(b.id) ? a : b));
      const nextPath = `/channels/${channelId}/messages?limit=${PAGE_SIZE}&after=${newestInPage.id}`;
      const nextPage = await discordFetch<RawDiscordMessage[]>(nextPath, workingToken, log);
      if (nextPage && nextPage.length > 0) {
        allMessages.push(...nextPage);
        lastPageSize = nextPage.length;
        pageCount++;
      } else {
        break;
      }
    }

    // Sort oldest-first for processing order
    allMessages.sort((a, b) => Number(BigInt(a.id) - BigInt(b.id)));

    const items: RawItem[] = [];

    for (const msg of allMessages) {
      // Skip bots
      if (msg.author.bot) continue;

      // Only DEFAULT (0) and REPLY (19)
      if (msg.type !== 0 && msg.type !== 19) continue;

      // Build content
      const parts: string[] = [];

      // Reply context
      if (msg.referenced_message?.content) {
        const truncated = msg.referenced_message.content.slice(0, 200);
        parts.push(`> ${truncated}`);
      }

      // Main content
      if (msg.content) {
        parts.push(msg.content);
      }

      // Embed descriptions
      if (msg.embeds && msg.embeds.length > 0) {
        for (const embed of msg.embeds) {
          if (embed.description) {
            parts.push(embed.description);
          }
        }
      }

      const content = parts.join('\n');
      if (!content) continue;

      const attachments = msg.attachments ?? [];
      const validAttachments = attachments.filter((a) => isValidDiscordUrl(a.url));
      const attachmentUrls = validAttachments.map((a) => a.url);
      const imageUrls = validAttachments.filter((a) => isImageUrl(a.url, a.content_type)).map((a) => a.url);

      let ts = new Date(msg.timestamp).getTime();
      if (Number.isNaN(ts)) {
        log.warn({ messageId: msg.id, channelId }, 'discord-rest: invalid timestamp, using current time');
        ts = Date.now();
      }

      items.push({
        id: ulid(),
        source: 'discord',
        sourceId: channelId,
        author: msg.author.username,
        content,
        timestamp: ts,
        engagement: 0,
        attachments: attachmentUrls.length > 0 ? attachmentUrls : undefined,
        metadata: {
          guildId: msg.guild_id ?? null,
          messageId: msg.id,
          imageUrls,
        },
      });
    }

    // The newest message ID becomes the new lastId for the next poll
    const newestId = allMessages[allMessages.length - 1]!.id;

    log.info(
      { channelId, fetched: allMessages.length, pages: pageCount, mapped: items.length, newestId },
      'discord-rest: polled channel',
    );

    return { items, lastId: newestId, usedToken: usedTokenConfig, fetchFailed: false };
  } finally {
    closeDispatchers(runtimeTokens, log);
  }
}
