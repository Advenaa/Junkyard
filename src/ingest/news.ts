import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { ulid } from 'ulid';
import { fetchValidated } from '../url-validator.js';
import type { Logger } from '../logger.js';
import type { RawItem } from './rss.js';

interface NewsAdapter {
  extract(url: string): Promise<RawItem | null>;
}

export function createNewsAdapter(log: Logger): NewsAdapter {
  return {
    async extract(url: string): Promise<RawItem | null> {
      try {
        const { response, validation } = await fetchValidated(url, {
          signal: AbortSignal.timeout(10_000),
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Podders/2.0)',
            'Accept': 'text/html',
          },
        });

        if (!response) {
          log.warn({ url, reason: validation.reason }, 'news: URL rejected');
          return null;
        }

        if (!response.ok) {
          log.warn({ url, status: response.status }, 'news: fetch failed');
          return null;
        }

        const html = await response.text();
        const { document } = parseHTML(html);

        const reader = new Readability(document);
        const article = reader.parse();

        if (!article || !article.textContent?.trim()) {
          log.warn({ url }, 'news: extraction returned empty content');
          return null;
        }

        return {
          id: ulid(),
          source: 'news',
          sourceId: url,
          author: article.byline ?? 'Unknown',
          content: article.textContent ?? '',
          timestamp: Date.now(),
          url,
          engagement: 0,
          metadata: {
            title: article.title,
            siteName: article.siteName,
            excerpt: article.excerpt,
          },
        };
      } catch (err: unknown) {
        log.warn({ url, err }, 'news: extraction error');
        return null;
      }
    },
  };
}
