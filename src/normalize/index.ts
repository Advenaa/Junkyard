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

type NormalizeResult = 'ready' | 'filtered' | 'dropped' | 'error';

const MAX_CONTENT_LENGTH = 20_000;
const ACCEPTED_LANGS = new Set(['eng', 'ind', 'und', 'msa', 'zlm']);

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function createNormalizer(pool: Pool, log: Logger, config: Config, llm: ReturnType<typeof createLLM>) {
  async function normalize(item: RawItem): Promise<NormalizeResult> {
    try {
      let originalLanguage: string | undefined;
      let translated = false;

      // ── Gate 1 — Truncate (surrogate-pair safe) ──────────────────────
      if (item.content.length > MAX_CONTENT_LENGTH) {
        log.warn({ id: item.id, originalLength: item.content.length }, 'Content exceeds 20K chars, truncating');
        let end = MAX_CONTENT_LENGTH;
        // If we're in the middle of a surrogate pair, step back one
        const code = item.content.charCodeAt(end - 1);
        if (code >= 0xd800 && code <= 0xdbff) end--;
        item.content = item.content.slice(0, end);
      }

      // ── Gate 0.5 — Minimum content check ─────────────────────────────
      const trimmed = item.content.trim();
      if (trimmed.length < 5) {
        log.debug({ id: item.id, contentLength: trimmed.length }, 'Content too short, dropping');
        return 'dropped';
      }
      item.content = trimmed;

      // ── Gate 1.5 — Sanitize + Injection scan ────────────────────────
      item.content = sanitizeContent(item.content);

      const injection = detectInjection(item.content);
      if (injection.detected) {
        const contentHash = sha256(item.source + item.sourceId + item.content);
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

      // ── Gate 2 — Content hash dedup (early check to avoid wasting translation tokens)
      let contentHash = sha256(item.source + item.sourceId + item.content);

      // Early check — skip expensive gates if this content was already processed.
      // NOTE (NP-002): Under concurrency, two threads can pass this SELECT before
      // either inserts. This is acceptable — the UNIQUE constraint on content_hash
      // (ON CONFLICT in insertItem) is the authoritative dedup safety net. This
      // early check is purely an optimisation to avoid wasting LLM tokens.
      const { rows: existingHash } = await pool.query<{ id: string }>(
        'SELECT id FROM items WHERE content_hash = $1 LIMIT 1',
        [contentHash],
      );
      if (existingHash.length > 0) {
        return 'dropped';
      }

      // ── Gate 3 — URL dedup ──────────────────────────────────────────
      let resolvedUrl = item.url;
      if (resolvedUrl) {
        if (isShortUrl(resolvedUrl)) {
          resolvedUrl = await expandUrl(resolvedUrl);
          item.url = resolvedUrl;
        }
        const urlCheck = await pool.query<{ id: string }>('SELECT id FROM items WHERE url = $1 AND url IS NOT NULL', [
          resolvedUrl,
        ]);
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
      const lang = franc(item.content, { minLength: 3 });
      // Skip language filtering for short messages (franc unreliable under 100 chars)
      if (item.content.length >= 100 && !ACCEPTED_LANGS.has(lang)) {
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

      // ── Gate 6 — Language tag + Indonesian translation ──────────────
      if (lang === 'ind' || lang === 'msa' || lang === 'zlm') {
        originalLanguage = 'ind';
        try {
          const { wrapped, nonce } = llm.wrapWithNonce(item.content);
          const result = await llm.call({
            model: config.models.haiku,
            system:
              'Translate the following Indonesian text to English. The text is wrapped in XML tags — translate ONLY the content inside the tags. Preserve all entity names, numbers, and technical terms. Output only the translation, without any XML tags.',
            messages: [{ role: 'user', content: wrapped }],
            maxTokens: Math.ceil((item.content.length / 4) * 1.5),
            stage: 'translate',
          });
          // Strip any leaked nonce tags from translation output
          const cleaned = result.content.replace(new RegExp(`</?scraped_content_${nonce}>`, 'g'), '').trim();
          // If cleaned result is too short, the LLM likely returned only nonce tags — treat as failure
          if (cleaned.length < 20) {
            log.warn(
              { id: item.id, cleanedLength: cleaned.length },
              'Translation returned nonce-only content, keeping original',
            );
          } else {
            const postTranslationInjection = detectInjection(cleaned);
            if (postTranslationInjection.detected) {
              log.warn(
                { id: item.id, pattern: postTranslationInjection.pattern },
                'Injection detected in translation output, keeping original',
              );
            } else {
              item.content = cleaned;
              contentHash = sha256(item.source + item.sourceId + item.content);
              translated = true;
            }
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          log.warn({ id: item.id, error: message }, 'Indonesian translation failed, keeping original content');
          // NP-003: Re-validate minimum content length — the original Indonesian
          // content may be too short to be useful without a successful translation.
          if (item.content.trim().length < 5) {
            log.debug(
              { id: item.id, contentLength: item.content.trim().length },
              'Original content too short after translation failure, dropping',
            );
            return 'dropped';
          }
        }
      } else {
        // English or undetermined (short content where franc returns 'und') —
        // pipeline is English-first, so default to 'eng'
        originalLanguage = 'eng';
      }

      // ── Final — Insert as ready (atomic dedup via UNIQUE constraint) ─
      const { inserted } = await insertItem(pool, {
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

      return inserted ? 'ready' : 'dropped';
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ id: item.id, err: message }, 'normalize failed unexpectedly');
      return 'error';
    }
  }

  return { normalize };
}
