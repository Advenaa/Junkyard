import { z } from 'zod';
import { ulid } from 'ulid';
import type { Config } from '../config.js';
import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';
import type { RawItem } from './rss.js';

const BASE_URL = 'https://api.twitterapi.io';
const MAX_PAGES = 5;

const TwitterTweetSchema = z.object({
  id: z.string(),
  text: z.string(),
  url: z.string().optional(),
  likeCount: z.number().default(0),
  retweetCount: z.number().default(0),
  quoteCount: z.number().default(0),
  createdAt: z.string(),
  author: z.object({
    userName: z.string(),
    name: z.string().optional(),
  }),
});

const TwitterResponseSchema = z.object({
  tweets: z.array(TwitterTweetSchema).default([]),
  has_next_page: z.boolean().default(false),
  next_cursor: z.string().optional(),
});

type TwitterTweet = z.infer<typeof TwitterTweetSchema>;

function computeEngagement(tweet: TwitterTweet): number {
  const raw = tweet.likeCount + tweet.retweetCount * 2 + tweet.quoteCount * 3;
  const score = Math.round(Math.log10(Math.max(1, raw)) * 20);
  return Math.min(100, Math.max(1, score));
}

function tweetToRawItem(tweet: TwitterTweet, sourceId: string): RawItem {
  return {
    id: ulid(),
    source: 'twitter',
    sourceId,
    author: tweet.author.userName,
    content: tweet.text,
    timestamp: new Date(tweet.createdAt).getTime(),
    url: tweet.url ?? undefined,
    engagement: computeEngagement(tweet),
    metadata: {
      tweetId: tweet.id,
      likes: tweet.likeCount,
      retweets: tweet.retweetCount,
      quotes: tweet.quoteCount,
    },
  };
}

function buildUrl(sourceId: string, cursor?: string): string {
  if (sourceId.startsWith('@')) {
    const handle = sourceId.slice(1);
    const params = new URLSearchParams({
      userName: handle,
      includeReplies: 'false',
    });
    if (cursor) params.set('cursor', cursor);
    return `${BASE_URL}/twitter/user/last_tweets?${params.toString()}`;
  }

  const params = new URLSearchParams({
    query: sourceId,
    queryType: 'Latest',
  });
  if (cursor) params.set('cursor', cursor);
  return `${BASE_URL}/twitter/tweet/advanced_search?${params.toString()}`;
}

const DEFAULT_RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes

export function createTwitterAdapter(config: Config, _pool: Pool, log: Logger) {
  let halted = false;
  let rateLimitedUntil = 0;

  async function fetchPage(
    sourceId: string,
    cursor?: string,
  ): Promise<z.infer<typeof TwitterResponseSchema> | null> {
    const url = buildUrl(sourceId, cursor);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'x-api-key': config.twitterApiKey! },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ sourceId, error: message }, 'Twitter API request failed');
      return null;
    }

    if (response.status === 401) {
      if (!halted) {
        log.fatal({ sourceId, status: 401 }, 'Twitter API key invalid — halting all Twitter polling');
        halted = true;
      }
      return null;
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const delayMs = retryAfter
        ? Number(retryAfter) * 1000
        : DEFAULT_RATE_LIMIT_MS;
      const backoffMs = Number.isFinite(delayMs) && delayMs > 0
        ? delayMs
        : DEFAULT_RATE_LIMIT_MS;
      rateLimitedUntil = Date.now() + backoffMs;
      log.warn(
        { sourceId, status: 429, backoffMs },
        'Twitter API rate limited — backing off',
      );
      return null;
    }

    if (response.status >= 500) {
      log.error({ sourceId, status: response.status }, 'Twitter API server error');
      return null;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      log.error({ sourceId }, 'Twitter API returned non-JSON response');
      return null;
    }

    const parsed = TwitterResponseSchema.safeParse(body);
    if (!parsed.success) {
      log.error(
        {
          sourceId,
          zodErrors: parsed.error.issues,
          responseShape: typeof body === 'object' && body !== null ? Object.keys(body) : typeof body,
        },
        'Twitter API response failed zod validation',
      );
      return null;
    }

    return parsed.data;
  }

  async function poll(
    sourceId: string,
    lastId: string | null,
  ): Promise<{ items: RawItem[]; lastId: string | null }> {
    const empty = { items: [], lastId: null };

    if (!config.twitterApiKey) {
      return empty;
    }

    if (halted) {
      return empty;
    }

    if (Date.now() < rateLimitedUntil) {
      log.debug({ sourceId, rateLimitedUntil }, 'Twitter poll skipped — rate limit backoff active');
      return empty;
    }

    const allTweets: TwitterTweet[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await fetchPage(sourceId, cursor);
      if (!result) break;

      allTweets.push(...result.tweets);

      if (!result.has_next_page || !result.next_cursor) break;
      cursor = result.next_cursor;
    }

    if (allTweets.length === 0) {
      return empty;
    }

    // Dedup: filter out tweets we've already seen
    const filtered = lastId
      ? allTweets.filter((t) => BigInt(t.id) > BigInt(lastId))
      : allTweets;

    if (filtered.length === 0) {
      return { items: [], lastId };
    }

    // Find the newest tweet ID
    const newestId = filtered.reduce<string>((max, t) => {
      return BigInt(t.id) > BigInt(max) ? t.id : max;
    }, filtered[0].id);

    const items = filtered.map((t) => tweetToRawItem(t, sourceId));

    return { items, lastId: newestId };
  }

  return { poll };
}
