import { ulid } from 'ulid';
import { MarketReportLLMSchema } from './schemas.js';
import type { MarketReport } from './schemas.js';
import { getSummariesByTimeWindow, insertReport, getAppConfig } from '../db/queries.js';
import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';
import type { Config } from '../config.js';

// ── LLM interface ─────────────────────────────────────────────────────

interface LLM {
  call(params: {
    model: string;
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    maxTokens: number;
    stage: string;
  }): Promise<{ content: string }>;
}

// ── System prompt ────────────────────────────────────────────────────

const PULSE_SYSTEM_PROMPT = `You are a market analyst writing a 3-hour market pulse update. Your audience trades crypto and watches Indonesian + global macro.

Return ONLY valid JSON matching this schema:
{
  "tldr": "1-2 sentence update (max 280 chars for mobile)",
  "keyEvents": ["what happened in the last 3 hours, max 5"],
  "entitySentiment": [{"name": "Entity", "sentiment": -1 to 1, "reason": "brief reason"}],
  "sections": [{"title": "Theme", "body": "analysis"}],
  "newProjects": []
}

Rules:
- Keep it brief. This is a pulse check, not a full report.
- If sentiment drifted significantly on an entity, call it out explicitly.
- Reference the prior pulse context to show continuity ("Previously X, now Y").
- If nothing notable happened, keep the TL;DR to one sentence and use minimal sections.
- All output in English.`;

// ── Types ────────────────────────────────────────────────────────────

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

interface EntitySentimentEntry {
  name: string;
  sentiment: number;
  reason: string;
}

interface DriftFlag {
  entity: string;
  prior: number;
  current: number;
  delta: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

function parseSummaryBody(body: string): ParsedSummaryBody | null {
  try {
    return JSON.parse(body) as ParsedSummaryBody;
  } catch {
    return null;
  }
}

function parseReportResponse(raw: string): MarketReport {
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

function computeAvgSentiment(report: MarketReport): number | null {
  if (report.entitySentiment.length === 0) return null;
  const sum = report.entitySentiment.reduce((acc, e) => acc + e.sentiment, 0);
  return Math.round((sum / report.entitySentiment.length) * 100) / 100;
}

function getDateString(timezone: string): string {
  const TZ_OFFSETS: Record<string, number> = {
    'Asia/Jakarta': 7,
    'Asia/Singapore': 8,
    'Asia/Tokyo': 9,
    'Asia/Shanghai': 8,
    'America/New_York': -5,
    'America/Los_Angeles': -8,
    'Europe/London': 0,
    UTC: 0,
  };
  const offsetMs = (TZ_OFFSETS[timezone] ?? 7) * 60 * 60 * 1000;
  const localNow = Date.now() + offsetMs;
  const d = new Date(localNow);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ── Factory ──────────────────────────────────────────────────────────

export function createPulse(pool: Pool, log: Logger, config: Config, llm: LLM) {
  /**
   * Get the prior pulse report (most recent pulse).
   */
  async function getPriorPulse(): Promise<{ tldr: string | null; entitySentiment: EntitySentimentEntry[] }> {
    const { rows } = await pool.query<{ body: string }>(
      `SELECT body FROM reports WHERE type = 'pulse' ORDER BY created_at DESC LIMIT 1`,
    );

    if (rows.length === 0) {
      return { tldr: null, entitySentiment: [] };
    }

    try {
      const parsed = JSON.parse(rows[0].body) as {
        tldr?: string;
        entitySentiment?: EntitySentimentEntry[];
      };
      return {
        tldr: parsed.tldr ?? null,
        entitySentiment: Array.isArray(parsed.entitySentiment) ? parsed.entitySentiment : [],
      };
    } catch {
      return { tldr: null, entitySentiment: [] };
    }
  }

  /**
   * Detect entities with significant sentiment drift between windows.
   */
  function detectDrift(
    currentEntities: Map<string, number>,
    priorEntities: EntitySentimentEntry[],
  ): DriftFlag[] {
    const flags: DriftFlag[] = [];
    const priorMap = new Map<string, number>();
    for (const entry of priorEntities) {
      priorMap.set(entry.name.toLowerCase(), entry.sentiment);
    }

    for (const [name, currentSentiment] of currentEntities) {
      const priorSentiment = priorMap.get(name.toLowerCase());
      if (priorSentiment !== undefined) {
        const delta = Math.abs(priorSentiment - currentSentiment);
        if (delta > 0.4) {
          flags.push({
            entity: name,
            prior: priorSentiment,
            current: currentSentiment,
            delta,
          });
        }
      }
    }

    return flags;
  }

  /**
   * Determine maxTokens based on summary count and urgency levels.
   */
  function computeMaxTokens(
    summaryCount: number,
    hasBreaking: boolean,
    hasElevated: boolean,
  ): number {
    if (summaryCount > 10 || hasBreaking) return 1500;
    if (summaryCount >= 4 || hasElevated) return 800;
    return 300;
  }

  /**
   * Build the user message for the pulse LLM call.
   */
  function buildUserMessage(
    summaries: { summary: string; source: string; entities: string; urgency: string }[],
    driftFlags: DriftFlag[],
    priorTldr: string | null,
  ): string {
    const parts: string[] = [];

    if (priorTldr) {
      parts.push(`<prior_pulse_tldr>${priorTldr}</prior_pulse_tldr>`);
    }

    const summaryBlocks = summaries.map(
      (s) => `[${s.source}] (${s.urgency}) ${s.summary}\nEntities: ${s.entities}`,
    );
    parts.push(`<summaries>\n${summaryBlocks.join('\n\n')}\n</summaries>`);

    if (driftFlags.length > 0) {
      const driftLines = driftFlags.map(
        (d) =>
          `${d.entity}: sentiment shifted from ${d.prior.toFixed(2)} to ${d.current.toFixed(2)} (delta: ${d.delta.toFixed(2)})`,
      );
      parts.push(
        `<sentiment_drift>\nThe following entities had significant sentiment changes since the last pulse:\n${driftLines.join('\n')}\n</sentiment_drift>`,
      );
    }

    return parts.join('\n\n');
  }

  async function runPulse(): Promise<MarketReport | null> {
    const now = Date.now();
    const threeHoursMs = 3 * 60 * 60 * 1000;
    const windowStart = now - threeHoursMs;

    log.info({ windowStart, windowEnd: now }, 'Running 3-hour pulse');

    // Load summaries from the last 3 hours
    const rows = await getSummariesByTimeWindow(pool, windowStart, now);

    // Quality gate: skip if no summaries
    if (rows.length === 0) {
      log.info('No summaries in the last 3 hours, skipping pulse');
      return null;
    }

    log.info({ summaryCount: rows.length }, 'Loaded summaries for pulse');

    // Parse summaries and collect entity sentiments
    const parsedSummaries: {
      summary: string;
      source: string;
      entities: string;
      urgency: string;
      parsedEntities: { name: string; sentiment: number }[];
    }[] = [];
    let hasBreaking = false;
    let hasElevated = false;

    for (const row of rows) {
      const parsed = parseSummaryBody(row.body);
      if (!parsed) {
        log.warn({ summaryId: row.id }, 'Failed to parse summary body, skipping');
        continue;
      }

      const urgency = row.urgency ?? parsed.urgency ?? 'routine';
      if (urgency === 'breaking') hasBreaking = true;
      if (urgency === 'elevated') hasElevated = true;

      const entityStr = parsed.entities
        .map((e) => `${e.name} (${e.type}, sentiment: ${e.sentiment})`)
        .join(', ');

      parsedSummaries.push({
        summary: parsed.summary,
        source: row.source,
        entities: entityStr,
        urgency,
        parsedEntities: parsed.entities.map((e) => ({ name: e.name, sentiment: e.sentiment })),
      });
    }

    if (parsedSummaries.length === 0) {
      log.warn('All summaries failed to parse, skipping pulse');
      return null;
    }

    // Build current entity sentiment map (average across mentions)
    const entitySentimentSums = new Map<string, { total: number; count: number }>();
    for (const s of parsedSummaries) {
      for (const e of s.parsedEntities) {
        const key = e.name.toLowerCase();
        const existing = entitySentimentSums.get(key) ?? { total: 0, count: 0 };
        existing.total += e.sentiment;
        existing.count += 1;
        entitySentimentSums.set(key, existing);
      }
    }
    const currentEntitySentiment = new Map<string, number>();
    for (const [key, val] of entitySentimentSums) {
      currentEntitySentiment.set(key, val.total / val.count);
    }

    // Drift detection: compare with prior pulse
    const prior = await getPriorPulse();
    const driftFlags = detectDrift(currentEntitySentiment, prior.entitySentiment);

    if (driftFlags.length > 0) {
      log.info(
        { driftCount: driftFlags.length, entities: driftFlags.map((d) => d.entity) },
        'Detected sentiment drift',
      );
    }

    // Activity-scaled maxTokens
    const maxTokens = computeMaxTokens(parsedSummaries.length, hasBreaking, hasElevated);

    // Build prompt
    const userMessage = buildUserMessage(parsedSummaries, driftFlags, prior.tldr);

    log.info(
      {
        summaries: parsedSummaries.length,
        maxTokens,
        hasPriorPulse: !!prior.tldr,
        driftFlags: driftFlags.length,
      },
      'Sending pulse to LLM',
    );

    // Call LLM
    const result = await llm.call({
      model: config.models.sonnet,
      system: PULSE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens,
      stage: 'pulse',
    });

    // Parse response
    const report = parseReportResponse(result.content);

    // Insert report
    const reportId = ulid();
    const timezone = (await getAppConfig(pool, 'timezone')) ?? 'Asia/Jakarta';
    const dateString = getDateString(timezone);
    const avgSentiment = computeAvgSentiment(report);

    await insertReport(pool, {
      id: reportId,
      date: dateString,
      type: 'pulse',
      body: JSON.stringify(report),
      tldr: report.tldr,
      sentiment: avgSentiment,
      createdAt: Date.now(),
    });

    log.info(
      {
        reportId,
        date: dateString,
        sections: report.sections.length,
        events: report.keyEvents.length,
        maxTokens,
      },
      'Pulse report created',
    );

    return report;
  }

  return { runPulse };
}
