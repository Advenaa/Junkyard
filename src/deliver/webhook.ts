import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';
import type { Config } from '../config.js';
import { getAppConfig } from '../db/queries.js';
import { fetchValidated, type UrlValidationResult, validateUrl } from '../url-validator.js';

interface EntitySentiment {
  name: string;
  sentiment: number;
  reason: string;
}

interface MarketReportParsed {
  tldr: string;
  keyEvents: string[];
  eventChains: string[];
  firstMovers?: string[];
  first_movers?: string[];
  alphaSignals?: string[];
  alpha_signals?: string[];
  marketCatalysts?: string[];
  market_catalysts?: string[];
  regionalDivergence?: string[];
  regional_divergence?: string[];
  narrativeShifts?: string[];
  narrative_shifts?: string[];
  priceAlerts?: string[];
  price_alerts?: string[];
  unusualActivity?: string[];
  unusual_activity?: string[];
  macroRegime?: {
    classification: 'risk-on' | 'risk-off' | 'transition' | 'unclear';
    confidence: number;
    rationale: string;
  } | null;
  macro_regime?: {
    classification: 'risk-on' | 'risk-off' | 'transition' | 'unclear';
    confidence: number;
    rationale: string;
  } | null;
  macroAlerts?: string[];
  macro_alerts?: string[];
  entitySentiment: EntitySentiment[];
  entity_sentiment?: EntitySentiment[];
  sections: { title: string; body: string }[];
  newProjects: { name: string; description: string }[];
  new_projects?: { name: string; description: string }[];
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
const MAX_CONSECUTIVE_DELIVERY_FAILURES = 5;
const DELIVERY_CIRCUIT_BREAKER_COOLDOWN_MS = 60 * 60 * 1000;
const FAILED_DELIVERY_RETRY_LOOKBACK_MS = 60 * 60 * 1000;
const FAILED_DAILY_RETRY_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const STALE_PENDING_DELIVERY_MS = 5 * 60 * 1000;

interface WebhookPostFailure {
  ok: false;
  reason:
    | 'ssrf_validation_failed'
    | 'retry_time_exceeded'
    | 'rate_limited'
    | 'client_error'
    | 'server_error'
    | 'unexpected_status'
    | 'transport_error';
  status?: number;
  responseDetail?: string;
  errorMessage?: string;
}

type WebhookPostResult = { ok: true } | WebhookPostFailure;

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

function formatMacroRegimeLabel(
  classification: NonNullable<MarketReportParsed['macroRegime']>['classification'],
): string {
  switch (classification) {
    case 'risk-on':
      return 'Risk-on';
    case 'risk-off':
      return 'Risk-off';
    case 'transition':
      return 'Transition';
    case 'unclear':
      return 'Unclear';
  }
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

  const macroRegime = parsed.macroRegime ?? parsed.macro_regime;
  if (macroRegime) {
    const confidencePct = Math.round(macroRegime.confidence * 100);
    fields.push({
      name: 'Macro Regime',
      value: truncate(
        `> ${formatMacroRegimeLabel(macroRegime.classification)} (${confidencePct}% confidence)\n> ${macroRegime.rationale}`,
        1024,
      ),
      inline: false,
    });
  }

  const firstMovers = parsed.firstMovers ?? parsed.first_movers ?? [];
  if (firstMovers.length > 0) {
    const bulleted = firstMovers.map((entry) => `> ${entry}`).join('\n');
    fields.push({
      name: 'First Movers',
      value: truncate(bulleted, 1024),
      inline: false,
    });
  }

  const newProjects = parsed.newProjects ?? parsed.new_projects ?? [];
  if (newProjects.length > 0) {
    const bulleted = newProjects.map(({ name, description }) => `> **${name}** — ${description}`).join('\n');
    fields.push({
      name: 'New Projects',
      value: truncate(bulleted, 1024),
      inline: false,
    });
  }

  const priceAlerts = parsed.priceAlerts ?? parsed.price_alerts ?? [];
  if (priceAlerts.length > 0) {
    const bulleted = priceAlerts.map((alert) => `> ${alert}`).join('\n');
    fields.push({
      name: 'Price Alerts',
      value: truncate(bulleted, 1024),
      inline: false,
    });
  }

  const alphaSignals = parsed.alphaSignals ?? parsed.alpha_signals ?? [];
  if (alphaSignals.length > 0) {
    const bulleted = alphaSignals.map((signal) => `> ${signal}`).join('\n');
    fields.push({
      name: 'Alpha Signals',
      value: truncate(bulleted, 1024),
      inline: false,
    });
  }

  const marketCatalysts = parsed.marketCatalysts ?? parsed.market_catalysts ?? [];
  if (marketCatalysts.length > 0) {
    const bulleted = marketCatalysts.map((catalyst) => `> ${catalyst}`).join('\n');
    fields.push({
      name: 'Market Catalysts',
      value: truncate(bulleted, 1024),
      inline: false,
    });
  }

  const regionalDivergence = parsed.regionalDivergence ?? parsed.regional_divergence ?? [];
  if (regionalDivergence.length > 0) {
    const bulleted = regionalDivergence.map((entry) => `> ${entry}`).join('\n');
    fields.push({
      name: 'Regional Divergence',
      value: truncate(bulleted, 1024),
      inline: false,
    });
  }

  const narrativeShifts = parsed.narrativeShifts ?? parsed.narrative_shifts ?? [];
  if (narrativeShifts.length > 0) {
    const bulleted = narrativeShifts.map((entry) => `> ${entry}`).join('\n');
    fields.push({
      name: 'Narrative Shifts',
      value: truncate(bulleted, 1024),
      inline: false,
    });
  }

  const unusualActivity = parsed.unusualActivity ?? parsed.unusual_activity ?? [];
  if (unusualActivity.length > 0) {
    const bulleted = unusualActivity.map((entry) => `> ${entry}`).join('\n');
    fields.push({
      name: 'Unusual Activity',
      value: truncate(bulleted, 1024),
      inline: false,
    });
  }

  const macroAlerts = parsed.macroAlerts ?? parsed.macro_alerts ?? [];
  if (macroAlerts.length > 0) {
    const bulleted = macroAlerts.map((alert) => `> ${alert}`).join('\n');
    fields.push({
      name: 'Macro Alerts',
      value: truncate(bulleted, 1024),
      inline: false,
    });
  }

  const entitySentiment = parsed.entitySentiment ?? parsed.entity_sentiment ?? [];
  if (entitySentiment.length > 0) {
    const sentimentLines = entitySentiment
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

async function postWithRetry(
  webhookUrl: string,
  payload: string,
  validation: UrlValidationResult,
  log: Logger,
): Promise<WebhookPostResult> {
  let rateLimitCount = 0;
  const startTime = Date.now();
  let lastFailure: WebhookPostFailure = { ok: false, reason: 'transport_error' };
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (Date.now() - startTime > MAX_TOTAL_RETRY_MS) {
      log.error({ elapsedMs: Date.now() - startTime }, 'webhook total retry time exceeded, giving up');
      return { ok: false, reason: 'retry_time_exceeded' };
    }
    try {
      const { response } = await fetchValidated(
        webhookUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: AbortSignal.timeout(15_000),
        },
        validation,
      );
      if (!response) {
        log.error({ webhookUrl, reason: validation.reason }, 'webhook POST blocked by SSRF validation');
        return {
          ok: false,
          reason: 'ssrf_validation_failed',
          responseDetail: validation.reason,
        };
      }

      if (response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return { ok: true };
      }

      // Drain response body on all non-2xx paths to prevent socket leaks
      const responseDetail = truncate((await response.text().catch(() => '')) || '', 200);

      if (response.status === 429) {
        rateLimitCount++;
        if (rateLimitCount >= MAX_RATE_LIMIT_RETRIES) {
          log.error({ rateLimitCount }, 'webhook rate limited too many times, giving up');
          return { ok: false, reason: 'rate_limited', status: 429, responseDetail };
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
          { status: response.status, attempt: attempt + 1, responseDetail },
          'webhook POST failed with client error, not retrying',
        );
        return { ok: false, reason: 'client_error', status: response.status, responseDetail };
      }

      if (response.status >= 500) {
        lastFailure = { ok: false, reason: 'server_error', status: response.status, responseDetail };
        log.warn(
          { status: response.status, attempt: attempt + 1, responseDetail },
          'webhook POST failed with server error, retrying',
        );
        await sleep(BACKOFF_MS[attempt] ?? 32000);
        continue;
      }

      log.error({ status: response.status, responseDetail }, 'webhook POST returned unexpected status');
      return { ok: false, reason: 'unexpected_status', status: response.status, responseDetail };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      lastFailure = { ok: false, reason: 'transport_error', errorMessage };
      log.error({ err, attempt: attempt + 1 }, 'webhook POST threw an error');
      if (attempt < MAX_RETRIES - 1) {
        await sleep(BACKOFF_MS[attempt] ?? 32000);
      }
    }
  }

  return lastFailure;
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

export async function recoverStalePendingReports(
  pool: Pool,
  log: Logger,
  staleMs: number = STALE_PENDING_DELIVERY_MS,
): Promise<number> {
  const threshold = Date.now() - staleMs;
  const result = await pool.query(
    `UPDATE reports SET delivery_status = 'failed'
     WHERE delivery_status = 'pending' AND created_at < $1`,
    [threshold],
  );
  const recovered = result.rowCount ?? 0;
  if (recovered > 0) {
    log.info({ recovered }, 'recovered stale pending report deliveries');
  }
  return recovered;
}

export function createDelivery(pool: Pool, log: Logger, config: Config) {
  let consecutiveDeliveryFailures = 0;
  let deliveryCircuitOpenUntil: number | null = null;
  let deliveryCircuitAlertSent = false;
  const pendingDeliveredStatusReportIds = new Set<string>();

  function isDeliveryCircuitOpen(now = Date.now()): boolean {
    if (deliveryCircuitOpenUntil == null) {
      return false;
    }

    if (now >= deliveryCircuitOpenUntil) {
      deliveryCircuitOpenUntil = null;
      deliveryCircuitAlertSent = false;
      log.info('webhook delivery circuit breaker cooldown elapsed — resuming delivery attempts');
      return false;
    }

    return true;
  }

  function resetDeliveryFailures(): void {
    if (consecutiveDeliveryFailures === 0 && deliveryCircuitOpenUntil == null) {
      return;
    }

    consecutiveDeliveryFailures = 0;
    deliveryCircuitOpenUntil = null;
    deliveryCircuitAlertSent = false;
  }

  async function sendCircuitBreakerAlert(failureCount: number): Promise<void> {
    if (!config.alertWebhookUrl || deliveryCircuitAlertSent) {
      return;
    }

    deliveryCircuitAlertSent = true;

    const validation = await validateUrl(config.alertWebhookUrl);
    if (!validation.valid || !validation.resolvedIp) {
      log.error({ reason: validation.reason }, 'delivery circuit breaker alert webhook failed SSRF validation');
      return;
    }

    const cooldownMinutes = Math.round(DELIVERY_CIRCUIT_BREAKER_COOLDOWN_MS / 60_000);
    const body = {
      embeds: [
        {
          title: 'Webhook Delivery Halted',
          description: `Report delivery failed ${failureCount} times in a row and is paused for ${cooldownMinutes} minutes.`,
          color: 0xff0000,
          timestamp: new Date().toISOString(),
        },
      ],
      allowed_mentions: { parse: [] as string[] },
    };

    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { response } = await fetchValidated(
          config.alertWebhookUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10_000),
          },
          validation,
        );
        if (!response) {
          log.error({ reason: validation.reason }, 'delivery circuit breaker alert webhook blocked during delivery');
          return;
        }
        if (response.ok) {
          await response.body?.cancel().catch(() => undefined);
          return;
        }
        if (response.status < 500) {
          await response.body?.cancel().catch(() => undefined);
          return;
        }
        await response.body?.cancel().catch(() => undefined);
        lastErr = new Error(`delivery circuit breaker alert returned ${response.status}`);
      } catch (err: unknown) {
        lastErr = err;
      }

      if (attempt === 0) {
        await sleep(2000);
      }
    }

    log.error({ err: lastErr }, 'delivery circuit breaker alert failed after 2 attempts');
  }

  async function recordDeliveryFailure(): Promise<void> {
    consecutiveDeliveryFailures++;
    if (consecutiveDeliveryFailures < MAX_CONSECUTIVE_DELIVERY_FAILURES) {
      return;
    }

    if (!isDeliveryCircuitOpen()) {
      deliveryCircuitOpenUntil = Date.now() + DELIVERY_CIRCUIT_BREAKER_COOLDOWN_MS;
      log.error({ consecutiveDeliveryFailures, deliveryCircuitOpenUntil }, 'webhook delivery circuit breaker tripped');
      await sendCircuitBreakerAlert(consecutiveDeliveryFailures);
    }
  }

  async function reconcileDeliveredStatus(reportId: string): Promise<boolean> {
    try {
      await updateDeliveryStatus(pool, reportId, 'delivered');
      pendingDeliveredStatusReportIds.delete(reportId);
      log.info({ reportId }, 'reconciled delivered status after earlier successful POST');
      return true;
    } catch (err: unknown) {
      log.error({ err, reportId }, 'failed to reconcile delivered status after earlier successful POST');
      return false;
    }
  }

  async function deliver(report: Report): Promise<boolean> {
    if (pendingDeliveredStatusReportIds.has(report.id)) {
      return reconcileDeliveredStatus(report.id);
    }

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

    if (isDeliveryCircuitOpen()) {
      log.warn(
        { reportId: report.id, deliveryCircuitOpenUntil },
        'webhook delivery circuit breaker is open, skipping delivery attempt',
      );
      await updateDeliveryStatus(pool, report.id, 'failed');
      return false;
    }

    const embed = buildEmbed(report, parsed, config);
    const payload = JSON.stringify({
      embeds: [embed],
      allowed_mentions: { parse: [] },
    });

    const postResult = await postWithRetry(webhookUrl, payload, validation, log);

    if (postResult.ok) {
      resetDeliveryFailures();
      log.info({ reportId: report.id, type: report.type }, 'webhook delivered');
      try {
        await updateDeliveryStatus(pool, report.id, 'delivered');
        pendingDeliveredStatusReportIds.delete(report.id);
        return true;
      } catch (err: unknown) {
        pendingDeliveredStatusReportIds.add(report.id);
        log.error(
          { err, reportId: report.id },
          'failed to persist delivered status after successful POST — will retry status reconciliation without re-sending',
        );
        return false;
      }
    }

    await recordDeliveryFailure();
    log.error(
      {
        reportId: report.id,
        type: report.type,
        failureReason: postResult.reason,
        status: postResult.status,
        responseDetail: postResult.responseDetail,
        errorMessage: postResult.errorMessage,
      },
      'webhook delivery failed after retries',
    );
    await updateDeliveryStatus(pool, report.id, 'failed');
    return false;
  }

  // D-020: Retry recently failed deliveries (last 1 hour, max 5 per run)
  async function retryFailed(): Promise<number> {
    if (isDeliveryCircuitOpen()) {
      log.warn(
        { deliveryCircuitOpenUntil },
        'webhook delivery circuit breaker is open, skipping failed-delivery retry',
      );
      return 0;
    }

    const { rows } = await pool.query<{ id: string; type: string; body: string; date: string }>(
      `SELECT id, type, body, date FROM reports
       WHERE (
         delivery_status = 'failed'
         OR (delivery_status = 'pending' AND created_at < $3)
       )
         AND (
           (type = 'daily' AND created_at > $1)
           OR (type != 'daily' AND created_at > $2)
         )
       ORDER BY created_at ASC
       LIMIT 5`,
      [
        Date.now() - FAILED_DAILY_RETRY_LOOKBACK_MS,
        Date.now() - FAILED_DELIVERY_RETRY_LOOKBACK_MS,
        Date.now() - STALE_PENDING_DELIVERY_MS,
      ],
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
