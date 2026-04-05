import type { Logger } from '../logger.js';

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

async function discordFetch<T>(path: string, token: string, log: Logger): Promise<T | null> {
  try {
    const response = await fetch(`${DISCORD_API}${path}`, {
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });

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

export function createDiscordRest(tokens: string[], log: Logger) {
  /**
   * Fetch all guilds visible across all tokens, deduplicated by guild ID.
   * Returns guilds sorted by name.
   */
  async function getGuilds(): Promise<DiscordGuild[]> {
    const guildMap = new Map<string, DiscordGuild>();

    for (const token of tokens) {
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
    for (const token of tokens) {
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

  return { getGuilds, getChannels };
}
