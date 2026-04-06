import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';
import type { Config } from '../config.js';
import { getAppConfig } from '../db/queries.js';
import { validateUrl } from '../url-validator.js';
import net from 'node:net';

interface EntitySentiment {
  name: string;
  sentiment: number;
  reason: string;
}

interface MarketReportParsed {
  tldr: string;
  keyEvents: string[];
  eventChains: string[];
  entitySentiment: EntitySentiment[];
  sections: { title: string; body: string }[];
  newProjects: { name: string; description: string }[];
}

interface Report {
  id: string;
  type: string;
  body: string;
  date: string;
}

interface DiscordField {
  name: string;
  value: string;
  inline: boolean;
}

interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields: DiscordField[];
  timestamp: string;
  footer: { text: string };
  url?: string;
}

const EMBED_COLORS: Record<string, number> = {
  daily: 0x5b8def,
  flash: 0xff6b35,
  pulse: 0x4a4a5a,
};

const MAX_RETRIES = 3;
const MAX_RATE_LIMIT_RETRIES = 5;
const MAX_RETRY_AFTER_MS = 60_000;
const MAX_TOTAL_RETRY_MS = 120_000;
const BACKOFF_MS = [2000, 8000, 32000];

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max - 3;
  // Don't split UTF-16 surrogate pairs
  if (end > 0 && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) {
    end--;
  }
  return text.slice(0, end) + '...';
}

export function colorForType(type: string): number {
  return EMBED_COLORS[type] ?? 0x4a4a5a;
}

export function buildTitle(type: string, date: string): string {
  if (type === 'daily') {
    return `Daily Market Report \u2014 ${date}`;
  }
  if (type === 'flash') {
    return `[FLASH] Market Report \u2014 ${date}`;
  }
  if (type === 'pulse') {
    const now = new Date();
    const wibTime = now.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta',
    });
    return `Market Pulse \u2014 ${wibTime} WIB`;
  }
  return `Market Report \u2014 ${date}`;
}

function buildSentimentLabel(sentiment: number): string {
  if (sentiment > 0.2) return 'bullish';
  if (sentiment < -0.2) return 'bearish';
  return 'neutral';
}

function formatSentimentValue(sentiment: number): string {
  const sign = sentiment > 0 ? '+' : '';
  return `${sign}${sentiment.toFixed(1)}`;
}

export function buildFields(parsed: MarketReportParsed): DiscordField[] {
  const fields: DiscordField[] = [];

  if (parsed.keyEvents.length > 0) {
    const bulleted = parsed.keyEvents.map((e) => `> ${e}`).join('\n');
    fields.push({
      name: 'Key Events',
      value: truncate(bulleted, 1024),
      inline: false,
    });
  }

  if (parsed.eventChains.length > 0) {
    const bulleted = parsed.eventChains.map((chain) => `> ${chain}`).join('\n');
    fields.push({
      name: 'Event Chains',
      value: truncate(bulleted, 1024),
      inline: false,
    });
  }

  if (parsed.entitySentiment.length > 0) {
    const sentimentLines = parsed.entitySentiment
      .slice(0, 6)
      .map((e) => {
        const label = buildSentimentLabel(e.sentiment);
        const value = formatSentimentValue(e.sentiment);
        return `**${e.name}** ${value} ${label}`;
      })
      .join('\n');
    fields.push({
      name: 'Sentiment',
      value: truncate(sentimentLines, 1024),
      inline: false,
    });
  }

  return fields.slice(0, 4);
}

const DISCORD_EMBED_TOTAL_LIMIT = 5900; // Discord enforces 6000; leave buffer

export function embedCharCount(embed: DiscordEmbed): number {
  let total = embed.title.length + embed.description.length + embed.footer.text.length + (embed.url?.length ?? 0);
  for (const field of embed.fields) {
    total += field.name.length + field.value.length;
  }
  return total;
}

export function enforceEmbedLimit(embed: DiscordEmbed): void {
  // First pass: progressively trim field values
  while (embedCharCount(embed) > DISCORD_EMBED_TOTAL_LIMIT && embed.fields.length > 0) {
    const longestField = embed.fields.reduce(
      (longest, f, i) => (f.value.length > longest.len ? { idx: i, len: f.value.length } : longest),
      { idx: 0, len: embed.fields[0]!.value.length },
    );

    const over = embedCharCount(embed) - DISCORD_EMBED_TOTAL_LIMIT;
    const currentValue = embed.fields[longestField.idx]!.value;

    if (currentValue.length > over + 3) {
      embed.fields[longestField.idx]!.value = truncate(currentValue, currentValue.length - over);
    } else {
      // Field too small to trim meaningfully — remove it
      embed.fields.splice(longestField.idx, 1);
    }
  }

  // Second pass: trim description if still over
  if (embedCharCount(embed) > DISCORD_EMBED_TOTAL_LIMIT) {
    const over = embedCharCount(embed) - DISCORD_EMBED_TOTAL_LIMIT;
    embed.description = truncate(embed.description, embed.description.length - over);
  }
}

export function buildEmbed(report: Report, parsed: MarketReportParsed, config: Config): DiscordEmbed {
  const embed: DiscordEmbed = {
    title: buildTitle(report.type, report.date),
    description: truncate(parsed.tldr, 4096),
    color: colorForType(report.type),
    fields: buildFields(parsed),
    timestamp: new Date().toISOString(),
    footer: { text: 'podders' },
  };

  if (config.publicUrl) {
    embed.url = `${config.publicUrl}/reports/${report.id}`;
  }

  enforceEmbedLimit(embed);

  return embed;
}

async function postWithRetry(webhookUrl: string, payload: string, log: Logger, hostHeader?: string): Promise<boolean> {
  let rateLimitCount = 0;
  const startTime = Date.now();
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (Date.now() - startTime > MAX_TOTAL_RETRY_MS) {
      log.error({ elapsedMs: Date.now() - startTime }, 'webhook total retry time exceeded, giving up');
      return false;
    }
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (hostHeader) headers['Host'] = hostHeader;
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body: payload,
        signal: AbortSignal.timeout(15_000),
      });

      if (response.ok) {
        return true;
      }

      // Drain response body on all non-2xx paths to prevent socket leaks
      await response.body?.cancel();

      if (response.status === 429) {
        rateLimitCount++;
        if (rateLimitCount >= MAX_RATE_LIMIT_RETRIES) {
          log.error({ rateLimitCount }, 'webhook rate limited too many times, giving up');
          return false;
        }
        const retryAfterHeader = response.headers.get('Retry-After');
        const parsed = retryAfterHeader ? parseFloat(retryAfterHeader) : NaN;
        const MIN_RETRY_AFTER_MS = 1000;
        const retryAfterMs =
          Number.isFinite(parsed) && parsed > 0
            ? Math.max(Math.min(Math.ceil(parsed * 1000), MAX_RETRY_AFTER_MS), MIN_RETRY_AFTER_MS)
            : (BACKOFF_MS[attempt] ?? 32000);
        log.warn(
          { status: 429, retryAfterMs, attempt: attempt + 1, rateLimitCount },
          'webhook rate limited, waiting before retry',
        );
        await sleep(retryAfterMs);
        attempt--; // Don't consume retry budget for rate limits
        continue;
      }

      if (response.status >= 400 && response.status < 500) {
        log.error(
          { status: response.status, attempt: attempt + 1 },
          'webhook POST failed with client error, not retrying',
        );
        return false;
      }

      if (response.status >= 500) {
        log.warn({ status: response.status, attempt: attempt + 1 }, 'webhook POST failed with server error, retrying');
        await sleep(BACKOFF_MS[attempt] ?? 32000);
        continue;
      }

      log.error({ status: response.status }, 'webhook POST returned unexpected status');
      return false;
    } catch (err: unknown) {
      log.error({ err, attempt: attempt + 1 }, 'webhook POST threw an error');
      if (attempt < MAX_RETRIES - 1) {
        await sleep(BACKOFF_MS[attempt] ?? 32000);
      }
    }
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function updateDeliveryStatus(pool: Pool, reportId: string, status: 'delivered' | 'failed'): Promise<void> {
  const deliveredAt = status === 'delivered' ? Date.now() : null;
  await pool.query(`UPDATE reports SET delivery_status = $1, delivered_at = $2 WHERE id = $3`, [
    status,
    deliveredAt,
    reportId,
  ]);
}

export function createDelivery(pool: Pool, log: Logger, config: Config) {
  async function deliver(report: Report): Promise<boolean> {
    let parsed: MarketReportParsed;
    try {
      parsed = JSON.parse(report.body) as MarketReportParsed;
    } catch (err: unknown) {
      log.error({ err, reportId: report.id }, 'failed to parse report body as JSON');
      await updateDeliveryStatus(pool, report.id, 'failed');
      return false;
    }

    const webhookUrl = await getAppConfig(pool, 'webhook_url');
    if (!webhookUrl) {
      log.warn('no webhook_url configured, skipping delivery');
      await updateDeliveryStatus(pool, report.id, 'failed');
      return false;
    }

    const validation = await validateUrl(webhookUrl);
    if (!validation.valid || !validation.resolvedIp) {
      log.error({ url: webhookUrl, reason: validation.reason }, 'webhook URL failed SSRF validation');
      await updateDeliveryStatus(pool, report.id, 'failed');
      return false;
    }

    // Pin to resolved IP to prevent DNS rebinding between validation and fetch
    const pinnedUrl = new URL(webhookUrl);
    pinnedUrl.hostname = net.isIPv6(validation.resolvedIp) ? `[${validation.resolvedIp}]` : validation.resolvedIp;
    const pinnedWebhookUrl = pinnedUrl.toString();
    const originalHost = new URL(webhookUrl).host;

    // Atomic idempotency: claim this report for delivery (skip if already delivered)
    const { rows: claimRows } = await pool.query<{ delivery_status: string }>(
      `UPDATE reports SET delivery_status = 'pending'
       WHERE id = $1 AND delivery_status != 'delivered'
       RETURNING delivery_status`,
      [report.id],
    );
    if (claimRows.length === 0) {
      log.info({ reportId: report.id }, 'Report already delivered, skipping');
      return true;
    }

    const embed = buildEmbed(report, parsed, config);
    const payload = JSON.stringify({
      embeds: [embed],
      allowed_mentions: { parse: [] },
    });

    const success = await postWithRetry(pinnedWebhookUrl, payload, log, originalHost);

    if (success) {
      log.info({ reportId: report.id, type: report.type }, 'webhook delivered');
      try {
        await updateDeliveryStatus(pool, report.id, 'delivered');
      } catch (err: unknown) {
        log.error(
          { err, reportId: report.id },
          'failed to update delivery status after successful POST — will remain pending but not re-sending',
        );
      }
      return true;
    }

    log.error({ reportId: report.id, type: report.type }, 'webhook delivery failed after retries');
    await updateDeliveryStatus(pool, report.id, 'failed');
    return false;
  }

  // D-020: Retry recently failed deliveries (last 1 hour, max 5 per run)
  async function retryFailed(): Promise<number> {
    const { rows } = await pool.query<{ id: string; type: string; body: string; date: string }>(
      `SELECT id, type, body, date FROM reports
       WHERE delivery_status = 'failed'
         AND created_at > $1
       ORDER BY created_at ASC
       LIMIT 5`,
      [Date.now() - 60 * 60 * 1000],
    );

    let retried = 0;
    for (const row of rows) {
      const success = await deliver(row);
      if (success) retried++;
    }

    if (rows.length > 0) {
      log.info({ attempted: rows.length, retried }, 'retried failed deliveries');
    }

    return retried;
  }

  return { deliver, retryFailed };
}
