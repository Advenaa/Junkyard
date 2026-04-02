import { ulid } from 'ulid';
import { MarketReportLLMSchema } from './schemas.js';
import type { MarketReport } from './schemas.js';
import { deduplicateEvents } from './dedup-events.js';
import { createCorrelator } from './correlate.js';
import type { CorrelatedEntity } from './correlate.js';
import {
  insertReport,
  dailyReportExists,
  getSummariesByTimeWindow,
  getAppConfig,
} from '../db/queries.js';
import type { SummaryRow } from '../db/queries.js';
import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';
import type { Config } from '../config.js';
import type { LLMCallResult, Stage } from '../llm.js';

// ── LLM interface ─────────────────────────────────────────────────────

interface LLM {
  call(params: {
    model: string;
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    maxTokens: number;
    stage: Stage;
  }): Promise<LLMCallResult>;
  wrapWithNonce(content: string): { wrapped: string; nonce: string };
}

// ── System prompts ────────────────────────────────────────────────────

const DAILY_SYSTEM_PROMPT = `You are a senior market analyst writing a daily intelligence digest. Your audience trades crypto and watches Indonesian + global macro.

Return ONLY valid JSON matching this schema:
{
  "tldr": "2-3 sentence executive summary (max 280 chars for mobile)",
  "keyEvents": ["factual bullets, max 10"],
  "entitySentiment": [{"name": "Entity", "sentiment": -1 to 1, "reason": "why"}],
  "sections": [{"title": "Theme Name", "body": "2-3 paragraph analysis"}],
  "newProjects": [{"name": "Project", "description": "what it is"}]
}

Rules:
- Write for someone who trades. Every insight should be actionable.
- Compare today's sentiment to yesterday's TL;DR. Call out what changed.
- Sections should reveal causal chains, not just list events.
- Max 4 sections. Focus on what matters most.
- All output in English.`;

const FLASH_SYSTEM_PROMPT = `You are a market intelligence analyst issuing a FLASH alert for a breaking event.

Return ONLY valid JSON matching this schema:
{
  "tldr": "What happened in 1-2 sentences (max 280 chars)",
  "keyEvents": ["timeline of events, max 5"],
  "entitySentiment": [{"name": "Entity", "sentiment": -1 to 1, "reason": "why"}],
  "sections": [{"title": "Analysis", "body": "what this means for traders"}],
  "newProjects": []
}

Rules:
- Speed over polish. Get the key facts out.
- Focus on what traders need to know RIGHT NOW.
- Include source attribution where possible.`;

// ── Timezone helpers ──────────────────────────────────────────────────

const TZ_OFFSETS: Record<string, number> = {
  'Asia/Jakarta': 7,
  'Asia/Singapore': 8,
  'Asia/Tokyo': 9,
  'Asia/Shanghai': 8,
  'Asia/Kolkata': 5.5,
  'Asia/Dubai': 4,
  'Europe/London': 0,
  'Europe/Berlin': 1,
  'Europe/Moscow': 3,
  'America/New_York': -5,
  'America/Chicago': -6,
  'America/Denver': -7,
  'America/Los_Angeles': -8,
  'Pacific/Auckland': 12,
  UTC: 0,
};

function getOffsetHours(timezone: string): number {
  return TZ_OFFSETS[timezone] ?? 7; // default to WIB
}

/**
 * Compute midnight-to-midnight window (epoch ms) for today in the given timezone.
 */
function getTodayWindow(timezone: string): { start: number; end: number; dateString: string } {
  const offsetMs = getOffsetHours(timezone) * 60 * 60 * 1000;
  const nowUtc = Date.now();
  const localNow = nowUtc + offsetMs;

  // Floor to midnight in local time
  const localMidnight = localNow - (localNow % (24 * 60 * 60 * 1000));
  // Convert back to UTC epoch
  const start = localMidnight - offsetMs;
  const end = start + 24 * 60 * 60 * 1000;

  // Format date string as YYYY-MM-DD in local time
  const d = new Date(start + offsetMs);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const dateString = `${year}-${month}-${day}`;

  return { start, end, dateString };
}

// ── Urgency scoring ───────────────────────────────────────────────────

const URGENCY_SCORES: Record<string, number> = {
  breaking: 3,
  elevated: 2,
  routine: 1,
};

interface ParsedSummaryBody {
  summary: string;
  urgency: string;
  entities: {
    name: string;
    type: string;
    sentiment: number;
    mentionCount: number;
  }[];
  keyEvents: string[];
  confidence: number;
}

function parseSummaryBody(body: string): ParsedSummaryBody | null {
  try {
    return JSON.parse(body) as ParsedSummaryBody;
  } catch {
    return null;
  }
}

function scoreSummary(row: SummaryRow, parsed: ParsedSummaryBody): number {
  const urgencyScore = URGENCY_SCORES[row.urgency ?? 'routine'] ?? 1;
  const entityCount = parsed.entities.length;
  const engagement = row.item_count; // proxy for engagement
  return (urgencyScore * 3) + (entityCount * 2) + Math.log(1 + engagement);
}

// ── Prompt builders ───────────────────────────────────────────────────

interface ScoredSummary {
  row: SummaryRow;
  parsed: ParsedSummaryBody;
  score: number;
}

function buildDailyUserMessage(
  summaries: ScoredSummary[],
  dedupedEvents: string[],
  correlated: CorrelatedEntity[],
  yesterdayTldr: string | null,
): string {
  const parts: string[] = [];

  // Yesterday context
  if (yesterdayTldr) {
    parts.push(`<yesterday_tldr>${yesterdayTldr}</yesterday_tldr>`);
  }

  // Summary data
  const summaryBlocks = summaries.map((s) => {
    const entities = s.parsed.entities
      .map((e) => `${e.name} (${e.type}, sentiment: ${e.sentiment})`)
      .join(', ');
    return `[${s.row.source}] ${s.parsed.summary}\nEntities: ${entities}`;
  });
  parts.push(`<summaries>\n${summaryBlocks.join('\n\n')}\n</summaries>`);

  // Key events
  if (dedupedEvents.length > 0) {
    parts.push(`<key_events>\n${dedupedEvents.map((e) => `- ${e}`).join('\n')}\n</key_events>`);
  }

  // Correlated entities
  if (correlated.length > 0) {
    const entityLines = correlated.map(
      (c) =>
        `${c.entityName}: weight=${c.weightedSum.toFixed(2)}, urgency=${c.urgency}, sources=${c.sources.map((s) => s.source).join('+')}`,
    );
    parts.push(
      `<correlated_entities>\n${entityLines.join('\n')}\n</correlated_entities>`,
    );
  }

  return parts.join('\n\n');
}

function buildFlashUserMessage(
  summaries: ScoredSummary[],
  correlated: CorrelatedEntity[],
): string {
  const parts: string[] = [];

  const entityNames = new Set(correlated.map((c) => c.entityName.toLowerCase()));

  // Correlated entity context
  const entityLines = correlated.map(
    (c) =>
      `${c.entityName}: weight=${c.weightedSum.toFixed(2)}, urgency=${c.urgency}, sources=${c.sources.map((s) => s.source).join('+')}`,
  );
  parts.push(
    `<breaking_entities>\n${entityLines.join('\n')}\n</breaking_entities>`,
  );

  // Relevant summaries
  const relevant = summaries.filter((s) =>
    s.parsed.entities.some((e) => entityNames.has(e.name.toLowerCase())),
  );

  if (relevant.length > 0) {
    const summaryBlocks = relevant.map((s) => {
      const entities = s.parsed.entities
        .map((e) => `${e.name} (sentiment: ${e.sentiment})`)
        .join(', ');
      return `[${s.row.source}] ${s.parsed.summary}\nEntities: ${entities}`;
    });
    parts.push(`<recent_summaries>\n${summaryBlocks.join('\n\n')}\n</recent_summaries>`);
  }

  // Key events from relevant summaries
  const events = relevant.flatMap((s) => s.parsed.keyEvents);
  const dedupedEvents = deduplicateEvents(events);
  if (dedupedEvents.length > 0) {
    parts.push(`<timeline>\n${dedupedEvents.map((e) => `- ${e}`).join('\n')}\n</timeline>`);
  }

  return parts.join('\n\n');
}

// ── Parse LLM response ───────────────────────────────────────────────

function parseReportResponse(raw: string): MarketReport {
  // Strip markdown fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    const firstNewline = cleaned.indexOf('\n');
    cleaned = cleaned.slice(firstNewline + 1);
    const lastFence = cleaned.lastIndexOf('```');
    if (lastFence !== -1) {
      cleaned = cleaned.slice(0, lastFence);
    }
  }
  const parsed: unknown = JSON.parse(cleaned);
  return MarketReportLLMSchema.parse(parsed);
}

// ── Compute average sentiment ─────────────────────────────────────────

function computeAvgSentiment(report: MarketReport): number | null {
  if (report.entitySentiment.length === 0) return null;
  const sum = report.entitySentiment.reduce((acc, e) => acc + e.sentiment, 0);
  return Math.round((sum / report.entitySentiment.length) * 100) / 100;
}

// ── Factory ───────────────────────────────────────────────────────────

export function createSynthesizer(pool: Pool, log: Logger, config: Config, llm: LLM) {
  /**
   * Parse all summaries into scored entries, filtering out unparseable bodies.
   */
  function parseSummaries(rows: SummaryRow[]): ScoredSummary[] {
    const result: ScoredSummary[] = [];
    for (const row of rows) {
      const parsed = parseSummaryBody(row.body);
      if (!parsed) {
        log.warn({ summaryId: row.id }, 'Failed to parse summary body, skipping');
        continue;
      }
      result.push({ row, parsed, score: scoreSummary(row, parsed) });
    }
    return result;
  }

  /**
   * Rank summaries and take the top N if there are more than the threshold.
   */
  function rankAndTrim(summaries: ScoredSummary[], threshold: number, limit: number): ScoredSummary[] {
    if (summaries.length <= threshold) return summaries;
    return [...summaries].sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async function getYesterdayTldr(): Promise<string | null> {
    const { rows } = await pool.query<{ tldr: string | null }>(
      `SELECT tldr FROM reports WHERE type='daily' ORDER BY created_at DESC LIMIT 1`,
    );
    return rows[0]?.tldr ?? null;
  }

  async function runDaily(): Promise<MarketReport | null> {
    const timezone = (await getAppConfig(pool, 'timezone')) ?? 'Asia/Jakarta';
    const { start, end, dateString } = getTodayWindow(timezone);

    log.info({ dateString, timezone, windowStart: start, windowEnd: end }, 'Running daily synthesis');

    // Check if report already exists for today
    const exists = await dailyReportExists(pool, dateString);
    if (exists) {
      log.info({ date: dateString }, 'Daily report already exists, skipping');
      return null;
    }

    // Load summaries for the window
    const rows = await getSummariesByTimeWindow(pool, start, end);
    if (rows.length === 0) {
      log.info({ date: dateString }, 'No summaries found for today, skipping daily synthesis');
      return null;
    }

    log.info({ summaryCount: rows.length }, 'Loaded summaries for daily synthesis');

    // Parse and score
    let summaries = parseSummaries(rows);
    if (summaries.length === 0) {
      log.warn('All summaries failed to parse, skipping daily synthesis');
      return null;
    }

    // Rank and trim if over 50
    summaries = rankAndTrim(summaries, 50, 30);

    // Collect and deduplicate key events
    const allEvents = summaries.flatMap((s) => s.parsed.keyEvents);
    const dedupedEvents = deduplicateEvents(allEvents);

    // Get yesterday's TL;DR for comparison
    const yesterdayTldr = await getYesterdayTldr();

    // Run cross-source correlation for the same window
    const correlator = createCorrelator(pool, log);
    const { correlated } = await correlator.run();

    log.info({ correlatedEntities: correlated.length }, 'Correlated entities for daily synthesis');

    // Build prompt
    const userMessage = buildDailyUserMessage(summaries, dedupedEvents, correlated, yesterdayTldr);

    log.info(
      { events: dedupedEvents.length, summaries: summaries.length, hasYesterday: !!yesterdayTldr },
      'Sending daily synthesis to LLM',
    );

    // Call LLM
    const result = await llm.call({
      model: config.models.sonnet,
      system: DAILY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 4000,
      stage: 'synthesize',
    });

    // Parse response
    const report = parseReportResponse(result.content);

    // Insert into DB
    const reportId = ulid();
    const avgSentiment = computeAvgSentiment(report);

    await insertReport(pool, {
      id: reportId,
      date: dateString,
      type: 'daily',
      body: JSON.stringify(report),
      tldr: report.tldr,
      sentiment: avgSentiment,
      createdAt: Date.now(),
    });

    log.info(
      { reportId, date: dateString, sections: report.sections.length, events: report.keyEvents.length },
      'Daily report created',
    );

    return report;
  }

  async function runFlash(correlatedEntities: CorrelatedEntity[]): Promise<MarketReport | null> {
    if (correlatedEntities.length === 0) {
      log.info('No correlated entities for flash report, skipping');
      return null;
    }

    // Load last 4 hours of summaries
    const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;
    const rows = await getSummariesByTimeWindow(pool, fourHoursAgo, Date.now());

    if (rows.length === 0) {
      log.info('No recent summaries for flash report, skipping');
      return null;
    }

    // Parse summaries
    const summaries = parseSummaries(rows);
    if (summaries.length === 0) {
      log.warn('All summaries failed to parse, skipping flash synthesis');
      return null;
    }

    // Filter to summaries mentioning correlated entities
    const entityNames = new Set(correlatedEntities.map((c) => c.entityName.toLowerCase()));
    const relevant = summaries.filter((s) =>
      s.parsed.entities.some((e) => entityNames.has(e.name.toLowerCase())),
    );

    if (relevant.length === 0) {
      log.info('No summaries mention correlated entities, skipping flash');
      return null;
    }

    // Build prompt
    const userMessage = buildFlashUserMessage(relevant, correlatedEntities);

    log.info(
      { entities: correlatedEntities.length, summaries: relevant.length },
      'Sending flash synthesis to LLM',
    );

    // Call LLM
    const result = await llm.call({
      model: config.models.sonnet,
      system: FLASH_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 2000,
      stage: 'synthesize',
    });

    // Parse response
    const report = parseReportResponse(result.content);

    // Insert into DB
    const reportId = ulid();
    const timezone = (await getAppConfig(pool, 'timezone')) ?? 'Asia/Jakarta';
    const { dateString } = getTodayWindow(timezone);
    const avgSentiment = computeAvgSentiment(report);

    await insertReport(pool, {
      id: reportId,
      date: dateString,
      type: 'flash',
      body: JSON.stringify(report),
      tldr: report.tldr,
      sentiment: avgSentiment,
      createdAt: Date.now(),
    });

    log.info(
      { reportId, entities: correlatedEntities.map((c) => c.entityName) },
      'Flash report created',
    );

    return report;
  }

  return { runDaily, runFlash };
}
