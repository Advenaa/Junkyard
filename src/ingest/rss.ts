import crypto from 'node:crypto';
import RssParser from 'rss-parser';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { ulid } from 'ulid';
import { validateUrl } from '../url-validator.js';
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

function syntheticGuid(pubDate: string | undefined, title: string | undefined): string {
  const input = `${pubDate ?? ''}${title ?? ''}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

async function extractArticle(link: string, originalContent: string, log: Logger): Promise<string> {
  try {
    const validation = await validateUrl(link);
    if (!validation.valid) {
      return originalContent;
    }

    const response = await fetch(link, {
      signal: AbortSignal.timeout(10_000),
    });

    const html = await response.text();
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
    const feed = await parser.parseURL(feedUrl);

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

    const items: RawItem[] = [];

    for (const item of filtered) {
      const author = item.creator ?? (item as Record<string, unknown>)['dc:creator'] as string ?? feed.title ?? 'Unknown';
      let content = item.contentSnippet ?? item.title ?? '';
      const timestamp = new Date(item.isoDate ?? Date.now()).getTime();
      const link = item.link;

      if (content.length < 500 && link) {
        content = await extractArticle(link, content, log);
      }

      items.push({
        id: ulid(),
        source: 'rss',
        sourceId: feedUrl,
        author,
        content,
        timestamp,
        url: link,
        engagement: 0,
        metadata: {
          feedTitle: feed.title,
          categories: item.categories ?? [],
          guid: item._guid,
        },
      });
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
