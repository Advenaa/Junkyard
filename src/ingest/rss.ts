import crypto from 'node:crypto';
import RssParser from 'rss-parser';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { ulid } from 'ulid';
import { fetchValidated } from '../url-validator.js';
import type { Logger } from '../logger.js';

export interface RawItem {
  id: string;
  source: 'discord' | 'twitter' | 'news' | 'rss';
  sourceId: string;
  author: string;
  content: string;
  timestamp: number;
  url?: string;
  engagement: number;
  attachments?: string[];
  metadata: Record<string, unknown>;
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const MAX_FEED_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_ITEMS_PER_POLL = 50;

function syntheticGuid(pubDate: string | undefined, title: string | undefined): string {
  const input = `${pubDate ?? ''}${title ?? ''}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

async function extractArticle(link: string, originalContent: string, log: Logger): Promise<string> {
  try {
    const { response } = await fetchValidated(link, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!response) {
      return originalContent;
    }

    const html = await response.text();
    if (html.length > MAX_FEED_BYTES) {
      log.warn({ link, size: html.length }, 'Article body exceeded size limit');
      return originalContent;
    }
    const { document } = parseHTML(html);
    const reader = new Readability(document);
    const article = reader.parse();

    if (article?.textContent && article.textContent.length > originalContent.length) {
      return article.textContent;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ link, error: message }, 'Article extraction failed, keeping original content');
  }

  return originalContent;
}

export async function pollFeed(
  feedUrl: string,
  lastId: string | null,
  log: Logger,
): Promise<{ items: RawItem[]; lastId: string | null }> {
  try {
    const parser = new RssParser();

    // RS-002: Fetch feed through SSRF validation instead of parser.parseURL
    const { response: feedResponse } = await fetchValidated(feedUrl, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!feedResponse) {
      throw new Error(`RSS feed URL failed SSRF validation: ${feedUrl}`);
    }
    if (!feedResponse.ok) {
      throw new Error(`RSS fetch failed: ${feedResponse.status}`);
    }
    const contentLength = Number(feedResponse.headers.get('content-length') ?? 0);
    if (contentLength > MAX_FEED_BYTES) {
      log.warn({ feedUrl, contentLength }, 'Feed too large, skipping');
      return { items: [], lastId };
    }
    const feedXml = await feedResponse.text();
    if (feedXml.length > MAX_FEED_BYTES) {
      log.warn({ feedUrl, size: feedXml.length }, 'Feed body exceeded size limit');
      return { items: [], lastId };
    }
    const feed = await parser.parseString(feedXml);

    const feedItems = (feed.items ?? []).map((item) => {
      const guid = item.guid ?? syntheticGuid(item.isoDate, item.title);
      return { ...item, _guid: guid };
    });

    let filtered: typeof feedItems;

    if (lastId !== null) {
      const lastIndex = feedItems.findIndex((item) => item._guid === lastId);
      if (lastIndex === -1) {
        // lastId not found in feed — take all items
        filtered = feedItems;
      } else {
        // Take only items after the lastId position
        filtered = feedItems.filter((item) => {
          const itemTime = new Date(item.isoDate ?? 0).getTime();
          const lastTime = new Date(feedItems[lastIndex]?.isoDate ?? 0).getTime();
          return itemTime > lastTime || (itemTime === lastTime && item._guid !== lastId);
        });
      }
    } else {
      const cutoff = Date.now() - TWO_HOURS_MS;
      filtered = feedItems.filter((item) => {
        const itemTime = new Date(item.isoDate ?? 0).getTime();
        return itemTime >= cutoff;
      });
    }

    // Sort by pubDate ascending
    filtered.sort((a, b) => {
      const timeA = new Date(a.isoDate ?? 0).getTime();
      const timeB = new Date(b.isoDate ?? 0).getTime();
      return timeA - timeB;
    });

    // RS-011: Cap item count to prevent unbounded article extraction
    if (filtered.length > MAX_ITEMS_PER_POLL) {
      log.warn({ feedUrl, total: filtered.length, cap: MAX_ITEMS_PER_POLL }, 'Feed item cap reached');
      filtered = filtered.slice(-MAX_ITEMS_PER_POLL); // Keep newest
    }

    const BATCH_SIZE = 5;
    const items: RawItem[] = [];

    // Process articles in batches to extract content in parallel
    for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
      const batch = filtered.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map(async (item) => {
          const author = item.creator ?? (item as Record<string, unknown>)['dc:creator'] as string ?? feed.title ?? 'Unknown';
          let content = item.contentSnippet ?? item.title ?? '';

          // RS-001: When contentSnippet is missing, extract text from item.content (full HTML)
          // rather than falling back to just the title headline.
          if (item.contentSnippet === undefined && item.content) {
            const { document: contentDoc } = parseHTML(`<!DOCTYPE html><html><body>${item.content}</body></html>`);
            const extracted = contentDoc.body.textContent?.trim() ?? '';
            if (extracted.length > content.length) {
              content = extracted;
            }
          }
          const hasDate = item.isoDate !== undefined && item.isoDate !== null;
          const timestamp = hasDate ? new Date(item.isoDate!).getTime() : Date.now();
          if (!hasDate) {
            log.warn({ guid: item._guid, title: item.title }, 'RSS item missing pubDate, using current time');
          }

          // RS-011: Resolve relative URLs against the feed URL
          let link = item.link ?? null;
          if (link && !link.startsWith('http')) {
            try {
              link = new URL(link, feedUrl).toString();
            } catch {
              link = null;
            }
          }

          if (content.length < 500 && link) {
            content = await extractArticle(link, content, log);
          }

          return {
            id: ulid(),
            source: 'rss' as const,
            sourceId: feedUrl,
            author,
            content,
            timestamp,
            url: link ?? undefined,
            engagement: -1, // RS-004: sentinel for "unknown" — RSS has no engagement metrics
            metadata: {
              feedTitle: feed.title,
              categories: item.categories ?? [],
              guid: item._guid,
            },
          } satisfies RawItem;
        }),
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          items.push(result.value);
        } else {
          log.warn({ error: result.reason }, 'RSS article processing failed in batch');
        }
      }
    }

    const newestGuid = filtered.length > 0
      ? filtered[filtered.length - 1]!._guid
      : lastId;

    return { items, lastId: newestGuid };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ feedUrl, error: message }, 'Failed to poll RSS feed');
    return { items: [], lastId };
  }
}
