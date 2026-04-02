import crypto from 'node:crypto';
import { franc } from 'franc';
import { ulid } from 'ulid';
import type { Pool } from '../db/connection.js';
import { insertItem } from '../db/queries.js';
import type { RawItem } from '../ingest/rss.js';
import type { createLLM } from '../llm.js';
import type { Logger } from '../logger.js';
import type { Config } from '../config.js';
import { sanitizeContent, detectInjection } from './instruct-detector.js';
import { isShortUrl, expandUrl } from './url-expand.js';
import { checkSpam } from './spam.js';

type NormalizeResult = 'ready' | 'filtered' | 'dropped';

const MAX_CONTENT_LENGTH = 20_000;
const ACCEPTED_LANGS = new Set(['eng', 'ind', 'und']);

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function createNormalizer(
  pool: Pool,
  log: Logger,
  config: Config,
  llm: ReturnType<typeof createLLM>,
) {
  async function normalize(item: RawItem): Promise<NormalizeResult> {
    let originalLanguage: string | undefined;
    let translated = false;

    // ── Gate 1 — Truncate ───────────────────────────────────────────
    if (item.content.length > MAX_CONTENT_LENGTH) {
      log.warn(
        { id: item.id, originalLength: item.content.length },
        'Content exceeds 20K chars, truncating',
      );
      item.content = item.content.slice(0, MAX_CONTENT_LENGTH);
    }

    // ── Gate 1.5 — Sanitize + Injection scan ────────────────────────
    item.content = sanitizeContent(item.content);

    const injection = detectInjection(item.content);
    if (injection.detected) {
      const contentHash = sha256(item.source + item.sourceId + item.content.slice(0, 200));
      await insertItem(pool, {
        id: ulid(),
        source: item.source,
        sourceId: item.sourceId,
        author: item.author,
        content: item.content,
        timestamp: item.timestamp,
        url: item.url,
        engagement: item.engagement,
        contentHash,
        status: 'filtered',
        originalLanguage,
        translated,
        attachments: item.attachments ? JSON.stringify(item.attachments) : undefined,
        filterReason: 'injection_detected',
        contentAnchor: undefined,
        createdAt: Date.now(),
      });
      return 'filtered';
    }

    // ── Gate 2 — Content hash dedup ─────────────────────────────────
    const contentHash = sha256(item.source + item.sourceId + item.content.slice(0, 200));
    const hashCheck = await pool.query<{ id: string }>(
      'SELECT id FROM items WHERE content_hash = $1',
      [contentHash],
    );
    if (hashCheck.rows.length > 0) {
      return 'dropped';
    }

    // ── Gate 3 — URL dedup ──────────────────────────────────────────
    let resolvedUrl = item.url;
    if (resolvedUrl) {
      if (isShortUrl(resolvedUrl)) {
        resolvedUrl = await expandUrl(resolvedUrl);
        item.url = resolvedUrl;
      }
      const urlCheck = await pool.query<{ id: string }>(
        'SELECT id FROM items WHERE url = $1 AND url IS NOT NULL',
        [resolvedUrl],
      );
      if (urlCheck.rows.length > 0) {
        return 'dropped';
      }
    }

    // ── Gate 4 — Spam filter ────────────────────────────────────────
    const spam = checkSpam(item);
    if (spam.isSpam) {
      await insertItem(pool, {
        id: ulid(),
        source: item.source,
        sourceId: item.sourceId,
        author: item.author,
        content: item.content,
        timestamp: item.timestamp,
        url: item.url,
        engagement: item.engagement,
        contentHash,
        status: 'filtered',
        originalLanguage,
        translated,
        attachments: item.attachments ? JSON.stringify(item.attachments) : undefined,
        filterReason: spam.rule,
        contentAnchor: undefined,
        createdAt: Date.now(),
      });
      return 'filtered';
    }

    // ── Gate 5 — Language detect ────────────────────────────────────
    const lang = franc(item.content);
    if (!ACCEPTED_LANGS.has(lang)) {
      await insertItem(pool, {
        id: ulid(),
        source: item.source,
        sourceId: item.sourceId,
        author: item.author,
        content: item.content,
        timestamp: item.timestamp,
        url: item.url,
        engagement: item.engagement,
        contentHash,
        status: 'filtered',
        originalLanguage: lang,
        translated,
        attachments: item.attachments ? JSON.stringify(item.attachments) : undefined,
        filterReason: 'unsupported_language:' + lang,
        contentAnchor: undefined,
        createdAt: Date.now(),
      });
      return 'filtered';
    }

    // ── Gate 6 — Indonesian translation ─────────────────────────────
    if (lang === 'ind') {
      originalLanguage = 'ind';
      try {
        const result = await llm.call({
          model: config.models.haiku,
          system:
            'Translate the following Indonesian text to English. Preserve all entity names, numbers, and technical terms. Output only the translation.',
          messages: [{ role: 'user', content: item.content }],
          maxTokens: Math.ceil((item.content.length / 4) * 1.5),
          stage: 'translate',
        });
        item.content = result.content;
        translated = true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(
          { id: item.id, error: message },
          'Indonesian translation failed, keeping original content',
        );
      }
    }

    // ── Final — Insert as ready ─────────────────────────────────────
    await insertItem(pool, {
      id: ulid(),
      source: item.source,
      sourceId: item.sourceId,
      author: item.author,
      content: item.content,
      timestamp: item.timestamp,
      url: item.url,
      engagement: item.engagement,
      contentHash,
      status: 'ready',
      originalLanguage,
      translated,
      attachments: item.attachments ? JSON.stringify(item.attachments) : undefined,
      filterReason: undefined,
      contentAnchor: undefined,
      createdAt: Date.now(),
    });

    return 'ready';
  }

  return { normalize };
}
