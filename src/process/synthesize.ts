import { ulid } from 'ulid';
import { deduplicateEvents } from './dedup-events.js';
import type { CorrelatedEntity } from './correlate.js';
import { parseSummaryBody } from './synthesis-shared.js';
import {
  buildDailyUserMessage,
  buildFlashUserMessage,
  type ScoredSummary,
  type NarrativeContext,
  type RecentEventAnalysisEntry,
  type PriceContextEntry,
  type AlphaPropagationContext,
} from './synthesis-context.js';
import { DAILY_SYSTEM_PROMPT, FLASH_SYSTEM_PROMPT } from './synthesize-prompts.js';
import {
  callReportWithRetry,
  computeAvgSentiment,
  EVENT_CHAIN_LOOKBACK_MS,
  FIRST_MOVER_LOOKBACK_MS,
  getTodayWindow,
  prepareBudgetedSynthesisPrompt,
  scoreSummary,
  toLoggedError,
} from './synthesize-utils.js';

// Prompt bodies were extracted to synthesize-prompts.ts.
// DAILY_SYSTEM_PROMPT / FLASH_SYSTEM_PROMPT still include schema fields like
// "priceAlerts", "regionalDivergence", "narrativeShifts", "firstMovers",
// "alphaSignals", "unusualActivity", "macroAlerts", and "macroRegime", plus guidance such as:
// - When <price_context> data is provided, populate "priceAlerts".
// - When <regional_divergence> data is provided, populate "regionalDivergence".
// - When <narrative_context> data is provided, populate "narrativeShifts".
// - When <first_movers> data is provided, populate "firstMovers".
// - When <alpha_propagation> data is provided, populate "alphaSignals".
// - When <unusual_activity> data is provided, populate "unusualActivity".
// - When <macro_context> data is provided, populate "macroAlerts" and "macroRegime".
// - Populate "unusualActivity" with the clearest crowding, attention-spike, or copy-paste cluster lines.
import {
  insertReport,
  insertMacroRegime,
  insertHealthEvent,
  dailyReportExists,
  getSummariesByTimeWindow,
  getAppConfig,
  getSentimentShiftAroundTime,
  getRecentEventChains,
  getLatestPricesForEntities,
  getLatestMacroSnapshots,
  getUnusualActivityOverview,
  getAlphaPropagationSummary,
  getEntityFirstMovers,
} from '../db/queries.js';
import type {
  SummaryRow,
  ReportRow,
  EntityFirstMoverRow,
  EventChainRow,
  UnusualActivityOverview,
} from '../db/queries.js';
import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';
import type { Config } from '../config.js';
import type { LLMCallResult, Stage } from '../llm.js';
import type { CalendarEventEntry } from '../knowledge/calendar.js';
import { buildMacroContext, summarizeCryptoSentiment } from '../macro/context.js';

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

let dailyAbortStreak = 0;

// ── Correlator interface ─────────────────────────────────────────────

interface Correlator {
  run(cutoff?: number): Promise<{ correlated: CorrelatedEntity[]; shouldFlash: boolean }>;
}

// ── Sentiment tracker interface ──────────────────────────────────────

import type { MomentumEntry } from '../knowledge/sentiment.js';
import type { DivergenceEntry } from '../knowledge/divergence.js';

export type { MomentumEntry, DivergenceEntry };

export interface SentimentTracker {
  runDaily(dateString: string, timezone: string): Promise<void>;
  getMomentumContext(entityIds: string[]): Promise<MomentumEntry[]>;
}

export interface DivergenceTracker {
  getDivergence(startTime: number, endTime: number, minMentions?: number): Promise<DivergenceEntry[]>;
}

export interface CalendarTracker {
  getUpcomingEvents(startTime: number, endTime: number, limit?: number): Promise<CalendarEventEntry[]>;
  getRecentEvents(startTime: number, endTime: number, limit?: number): Promise<CalendarEventEntry[]>;
}

// ── Factory ───────────────────────────────────────────────────────────

export function createSynthesizer(
  pool: Pool,
  log: Logger,
  config: Config,
  llm: LLM,
  correlator: Correlator,
  sentimentTracker: SentimentTracker,
  divergenceTracker: DivergenceTracker,
  calendarTracker: CalendarTracker = { getUpcomingEvents: async () => [], getRecentEvents: async () => [] },
) {
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

  async function loadContextOrDefault<T>(label: string, fallback: T, load: () => Promise<T>): Promise<T> {
    try {
      return await load();
    } catch (err: unknown) {
      log.warn({ err: toLoggedError(err) }, `Failed to load ${label}, continuing without it`);
      return fallback;
    }
  }

  function succeed<T>(value: T): T {
    dailyAbortStreak = 0;
    return value;
  }

  async function recordDailyAbort(err: Error): Promise<void> {
    dailyAbortStreak += 1;
    const severity = dailyAbortStreak >= 2 ? 'critical' : 'error';
    const timestamp = Date.now();

    try {
      await insertHealthEvent(pool, {
        id: ulid(),
        category: 'synth_aborted',
        severity,
        message: `daily synthesis aborted: ${err.message}`,
        metadata: {
          stage: 'daily',
          error: err.message,
          timestamp,
        },
        createdAt: timestamp,
      });
    } catch (healthErr: unknown) {
      log.error({ err: toLoggedError(healthErr), stage: 'daily', synthErr: err }, 'Failed to record synth abort');
    }
  }

  async function recordFlashAbort(err: Error): Promise<void> {
    const timestamp = Date.now();

    try {
      await insertHealthEvent(pool, {
        id: ulid(),
        category: 'synth_aborted',
        severity: 'error',
        message: `flash synthesis aborted: ${err.message}`,
        metadata: {
          stage: 'flash',
          error: err.message,
          timestamp,
        },
        createdAt: timestamp,
      });
    } catch (healthErr: unknown) {
      log.error({ err: toLoggedError(healthErr), stage: 'flash', synthErr: err }, 'Failed to record synth abort');
    }
  }

  async function getYesterdayTldr(): Promise<string | null> {
    const { rows } = await pool.query<{ tldr: string | null }>(
      `SELECT tldr FROM reports WHERE type='daily' ORDER BY created_at DESC LIMIT 1`,
    );
    return rows[0]?.tldr ?? null;
  }

  async function runDaily(): Promise<ReportRow | null> {
    try {
      const timezone =
        (await loadContextOrDefault<string | null>('daily synthesis timezone', 'Asia/Jakarta', () =>
          getAppConfig(pool, 'timezone'),
        )) ?? 'Asia/Jakarta';
      const { start, end, dateString } = getTodayWindow(timezone);

      log.info({ dateString, timezone, windowStart: start, windowEnd: end }, 'Running daily synthesis');

      // Check if report already exists for today
      const exists = await loadContextOrDefault('existing daily report state', false, () =>
        dailyReportExists(pool, dateString),
      );
      if (exists) {
        log.info({ date: dateString }, 'Daily report already exists, skipping');
        return succeed(null);
      }

      // Load summaries for the window
      const rows = await loadContextOrDefault<SummaryRow[]>('daily summaries', [], () =>
        getSummariesByTimeWindow(pool, start, end),
      );
      const quietDay = rows.length === 0;

      if (quietDay) {
        log.info({ date: dateString }, 'No summaries found for today — generating quiet market report');
      } else {
        log.info({ summaryCount: rows.length }, 'Loaded summaries for daily synthesis');
      }

      // Parse and score (empty array on quiet days)
      let summaries = parseSummaries(rows);
      if (!quietDay && summaries.length === 0) {
        log.warn('All summaries failed to parse, skipping daily synthesis');
        return succeed(null);
      }

      // Rank and trim if over 50
      summaries = rankAndTrim(summaries, 50, 30);

      // Get yesterday's TL;DR for comparison
      const yesterdayTldr = await loadContextOrDefault<string | null>("yesterday's TL;DR", null, getYesterdayTldr);

      // Run cross-source correlation for the same window
      const { correlated } = quietDay
        ? { correlated: [] as CorrelatedEntity[] }
        : await loadContextOrDefault<{ correlated: CorrelatedEntity[]; shouldFlash: boolean }>(
            'daily cross-source correlation',
            { correlated: [], shouldFlash: false },
            () => correlator.run(start),
          );

      log.info({ correlatedEntities: correlated.length }, 'Correlated entities for daily synthesis');

      // SM-008: Fetch entity IDs with alias fallback
      const entityNames = [...new Set(correlated.map((c) => c.entityName))];
      const normalizedNames = entityNames.map((n) => n.toLowerCase());
      const entityIdRows =
        entityNames.length > 0
          ? await loadContextOrDefault<Array<{ id: string; name: string }>>(
              'daily entity alias lookup',
              [],
              async () =>
                (
                  await pool.query<{ id: string; name: string }>(
                    `SELECT DISTINCT e.id, e.name FROM entities e
           LEFT JOIN entity_aliases ea ON ea.entity_id = e.id
           WHERE e.name = ANY($1) OR ea.alias = ANY($2)`,
                    [entityNames, normalizedNames],
                  )
                ).rows,
            )
          : [];
      const entityIds = entityIdRows.map((r) => r.id);
      const momentum =
        entityIds.length > 0
          ? await loadContextOrDefault<MomentumEntry[]>('daily sentiment momentum', [], () =>
              sentimentTracker.getMomentumContext(entityIds),
            )
          : [];

      log.info({ momentumEntries: momentum.length }, 'Loaded sentiment momentum for daily synthesis');

      // Fetch latest prices for token entities
      const priceSnapshots =
        entityIds.length > 0
          ? await loadContextOrDefault<Awaited<ReturnType<typeof getLatestPricesForEntities>>>(
              'daily price snapshots',
              [],
              () => getLatestPricesForEntities(pool, entityIds),
            )
          : [];
      const entityIdToName = new Map(entityIdRows.map((r) => [r.id, r.name]));
      const momentumByName = new Map(momentum.map((m) => [m.entityName.toLowerCase(), m.avgSentiment]));
      const firstMovers =
        entityIds.length > 0
          ? await loadContextOrDefault<EntityFirstMoverRow[]>('daily first-mover context', [], () =>
              getEntityFirstMovers(pool, entityIds, start - FIRST_MOVER_LOOKBACK_MS, 6),
            )
          : [];

      const priceContext: PriceContextEntry[] = priceSnapshots.map((snap) => {
        const name = entityIdToName.get(snap.entityId) ?? snap.entityId;
        const sentiment = momentumByName.get(name.toLowerCase()) ?? null;
        let contrarian: string | null = null;

        if (sentiment !== null && snap.priceChange24h !== null) {
          if (sentiment < -0.2 && snap.priceChange24h > 3) {
            contrarian = 'price rising, community bearish — potential accumulation or short squeeze';
          } else if (sentiment > 0.2 && snap.priceChange24h < -3) {
            contrarian = 'price falling, community bullish — potential distribution or capitulation';
          }
        }

        return {
          entityName: name,
          priceUsd: snap.priceUsd,
          priceChange24h: snap.priceChange24h,
          priceChange7d: snap.priceChange7d,
          sentiment,
          contrarian,
        };
      });

      log.info(
        {
          priceEntries: priceContext.length,
          contrarianCount: priceContext.filter((p) => p.contrarian).length,
          firstMoverEntries: firstMovers.length,
        },
        'Loaded price context for daily synthesis',
      );

      // Fetch alpha propagation for active entities (7-day window)
      const alphaLookbackMs = 7 * 24 * 60 * 60 * 1000;
      const alphaSinceTime = Date.now() - alphaLookbackMs;
      const alphaPropagation: AlphaPropagationContext[] = [];

      if (entityIds.length > 0) {
        try {
          const alphaResults = await Promise.all(
            entityIds.map((id) => getAlphaPropagationSummary(pool, id, alphaSinceTime)),
          );
          for (let i = 0; i < entityIds.length; i++) {
            const tiers = alphaResults[i];
            if (tiers.length < 2) continue; // Need at least 2 tiers for propagation
            const name = entityIdToName.get(entityIds[i]) ?? entityIds[i];
            // Sort by first mention time
            tiers.sort((a, b) => a.firstMentionTime - b.firstMentionTime);
            // Calculate propagation speed from earliest to latest tier
            const earliest = tiers[0];
            const latest = tiers[tiers.length - 1];
            const diffMs = latest.firstMentionTime - earliest.firstMentionTime;
            const diffHours = diffMs / (1000 * 60 * 60);
            const propagationSpeed =
              diffHours < 1
                ? `${earliest.tier} → ${latest.tier} in ${Math.round(diffMs / 60000)}m`
                : `${earliest.tier} → ${latest.tier} in ${diffHours.toFixed(1)}h`;
            alphaPropagation.push({ entityName: name, tiers, propagationSpeed });
          }
          log.info({ alphaEntries: alphaPropagation.length }, 'Loaded alpha propagation context for daily synthesis');
        } catch (alphaErr: unknown) {
          log.warn(
            { err: toLoggedError(alphaErr) },
            'Failed to fetch alpha propagation context, continuing without it',
          );
        }
      }

      // Use trailing 24h for divergence (not calendar day) to capture prior afternoon/evening
      const divergenceEnd = Date.now();
      const divergenceStart = divergenceEnd - 24 * 60 * 60 * 1000;
      const divergence = await loadContextOrDefault<DivergenceEntry[]>('daily regional divergence', [], () =>
        divergenceTracker.getDivergence(divergenceStart, divergenceEnd),
      );

      log.info({ divergenceEntries: divergence.length }, 'Loaded regional divergence for daily synthesis');

      // SY-001: Fetch recent narratives (last 2 days)
      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
      const narrativeRows = await loadContextOrDefault<
        Array<{ name: string; signal_strength: string; member_count: number; created_at: number }>
      >(
        'daily narrative context',
        [],
        async () =>
          (
            await pool.query<{
              name: string;
              signal_strength: string;
              member_count: number;
              created_at: number;
            }>(
              `SELECT name, signal_strength, member_count, created_at
       FROM narratives
       WHERE created_at > $1
       ORDER BY member_count DESC LIMIT 10`,
              [twoDaysAgo],
            )
          ).rows,
      );
      const narratives: NarrativeContext[] = narrativeRows.map((r) => ({
        name: r.name,
        growthRate: r.signal_strength,
        summaryCount: r.member_count,
        createdAt: r.created_at,
      }));

      log.info({ narrativeCount: narratives.length }, 'Loaded narrative context for daily synthesis');

      const calendarStart = Date.now();
      const recentCalendarStart = calendarStart - 24 * 60 * 60 * 1000;
      const calendarEnd = calendarStart + 48 * 60 * 60 * 1000;
      const recentCalendarEvents = await loadContextOrDefault<CalendarEventEntry[]>(
        'daily recent calendar events',
        [],
        () => calendarTracker.getRecentEvents(recentCalendarStart, calendarStart),
      );
      const recentEventAnalysis = await loadContextOrDefault<RecentEventAnalysisEntry[]>(
        'daily recent event sentiment analysis',
        [],
        async () =>
          (
            await Promise.all(
              recentCalendarEvents.slice(0, 3).map(async (event) => {
                const shift = await getSentimentShiftAroundTime(pool, event.nextOccurrence, event.entityId);
                if (shift.pre_mention_count === 0 && shift.post_mention_count === 0) {
                  return null;
                }
                return {
                  event,
                  preAvgSentiment: shift.pre_avg_sentiment,
                  preMentionCount: shift.pre_mention_count,
                  postAvgSentiment: shift.post_avg_sentiment,
                  postMentionCount: shift.post_mention_count,
                  sentimentDelta:
                    shift.pre_avg_sentiment !== null && shift.post_avg_sentiment !== null
                      ? shift.post_avg_sentiment - shift.pre_avg_sentiment
                      : null,
                };
              }),
            )
          ).filter((entry): entry is RecentEventAnalysisEntry => entry !== null),
      );
      const chainEntityNames = [
        ...new Set(
          summaries
            .flatMap((summary) => summary.parsed.entities.map((entity) => entity.name.trim()))
            .filter((name) => name.length > 0),
        ),
      ];
      const normalizedChainNames = chainEntityNames.map((name) => name.toLowerCase());
      const chainEntityRows =
        chainEntityNames.length > 0
          ? await loadContextOrDefault<Array<{ id: string }>>(
              'daily event-chain entity lookup',
              [],
              async () =>
                (
                  await pool.query<{ id: string }>(
                    `SELECT DISTINCT e.id FROM entities e
           LEFT JOIN entity_aliases ea ON ea.entity_id = e.id
           WHERE e.name = ANY($1::text[]) OR ea.alias = ANY($2::text[])`,
                    [chainEntityNames, normalizedChainNames],
                  )
                ).rows,
            )
          : [];
      const recentEventChains = await loadContextOrDefault<EventChainRow[]>('daily recent event chains', [], () =>
        getRecentEventChains(
          pool,
          chainEntityRows.map((row) => row.id),
          Date.now() - EVENT_CHAIN_LOOKBACK_MS,
        ),
      );
      const calendarEvents = await loadContextOrDefault<CalendarEventEntry[]>(
        'daily upcoming calendar events',
        [],
        () => calendarTracker.getUpcomingEvents(calendarStart, calendarEnd),
      );
      const unusualActivity = await loadContextOrDefault<UnusualActivityOverview>(
        'daily unusual activity watchlist',
        { latestDate: null, entries: [] },
        () => getUnusualActivityOverview(pool, 8, timezone),
      );
      const macroSnapshots = await loadContextOrDefault<Awaited<ReturnType<typeof getLatestMacroSnapshots>>>(
        'daily macro snapshots',
        [],
        () => getLatestMacroSnapshots(pool),
      );
      const macroContext = buildMacroContext(macroSnapshots);

      log.info(
        {
          recentCalendarEventCount: recentCalendarEvents.length,
          recentEventAnalysisCount: recentEventAnalysis.length,
          recentEventChainCount: recentEventChains.length,
          calendarEventCount: calendarEvents.length,
        },
        'Loaded calendar events for daily synthesis',
      );
      log.info(
        {
          unusualActivityEntries: unusualActivity.entries.length,
          macroEntries: macroContext.entries.length,
          macroBias: macroContext.overallBias,
        },
        'Loaded macro context for daily synthesis',
      );

      const prompt = prepareBudgetedSynthesisPrompt({
        llm,
        log,
        model: config.models.thinkalot,
        systemPrompt: DAILY_SYSTEM_PROMPT,
        maxTokens: 4000,
        label: 'Daily synthesis',
        summaries,
        minSummaryCount: quietDay ? 0 : 1,
        buildUserMessage: (candidateSummaries) => {
          const dedupedEvents = deduplicateEvents(candidateSummaries.flatMap((summary) => summary.parsed.keyEvents));
          const cryptoAggregate = summarizeCryptoSentiment(
            candidateSummaries.flatMap((summary) =>
              summary.parsed.entities.map((entity) => ({
                type: entity.type,
                sentiment: entity.sentiment,
                mentionCount: entity.mentionCount,
              })),
            ),
          );

          return buildDailyUserMessage(
            candidateSummaries,
            dedupedEvents,
            correlated,
            yesterdayTldr,
            momentum,
            divergence,
            priceContext,
            firstMovers,
            unusualActivity,
            macroContext,
            cryptoAggregate,
            alphaPropagation,
            narratives,
            recentCalendarEvents,
            recentEventAnalysis,
            recentEventChains,
            calendarEvents,
            timezone,
            quietDay,
          );
        },
      });
      if (!prompt) return succeed(null);

      summaries = prompt.summaries;
      const dedupedEvents = deduplicateEvents(summaries.flatMap((summary) => summary.parsed.keyEvents));

      log.info(
        {
          events: dedupedEvents.length,
          summaries: summaries.length,
          hasYesterday: !!yesterdayTldr,
          estimatedInputTokens: prompt.estimatedInputTokens,
          inputBudget: prompt.inputBudget,
        },
        'Sending daily synthesis to LLM',
      );

      const report = await callReportWithRetry(
        llm,
        log,
        config.models.thinkalot,
        DAILY_SYSTEM_PROMPT,
        prompt.wrappedContent,
        4000,
        'synthesize',
        'Daily synthesis',
      );
      if (!report) return succeed(null);

      // Insert into DB
      const reportId = ulid();
      const avgSentiment = computeAvgSentiment(report);
      const sourceFamilies = [...new Set(summaries.map((s) => s.row.source))].sort();

      let reportRow: ReportRow;
      try {
        reportRow = await insertReport(pool, {
          id: reportId,
          date: dateString,
          type: 'daily',
          body: JSON.stringify({ ...report, sourceFamilies }),
          tldr: report.tldr,
          sentiment: avgSentiment,
          createdAt: Date.now(),
        });
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
          log.info({ date: dateString }, 'Daily report race: another process created it first');
          return succeed(null);
        }
        throw err;
      }

      log.info(
        { reportId, date: dateString, sections: report.sections.length, events: report.keyEvents.length },
        'Daily report created',
      );

      if (report.macroRegime) {
        try {
          await insertMacroRegime(pool, {
            reportId: reportRow.id,
            date: reportRow.date,
            reportType: 'daily',
            classification: report.macroRegime.classification,
            confidence: report.macroRegime.confidence,
            rationale: report.macroRegime.rationale,
            createdAt: reportRow.created_at,
          });
        } catch (err: unknown) {
          log.warn({ err: toLoggedError(err), reportId: reportRow.id }, 'Failed to persist daily macro regime history');
        }
      }

      return succeed(reportRow);
    } catch (err: unknown) {
      const loggedErr = toLoggedError(err);
      await recordDailyAbort(loggedErr);
      throw loggedErr;
    }
  }

  async function runFlash(correlatedEntities: CorrelatedEntity[]): Promise<ReportRow | null> {
    try {
      if (correlatedEntities.length === 0) {
        log.info('No correlated entities for flash report, skipping');
        return null;
      }

      // Load last 4 hours of summaries
      const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;
      const rows = await loadContextOrDefault<SummaryRow[]>('flash summaries', [], () =>
        getSummariesByTimeWindow(pool, fourHoursAgo, Date.now()),
      );

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
      const relevant = summaries.filter((s) => s.parsed.entities.some((e) => entityNames.has(e.name.toLowerCase())));

      if (relevant.length === 0) {
        log.info('No summaries mention correlated entities, skipping flash');
        return null;
      }

      // Duplicate guard: skip if a flash report was already created in the last 4h
      const existingFlash = await loadContextOrDefault<Array<{ id: string }>>(
        'flash existing report state',
        [],
        async () =>
          (
            await pool.query<{ id: string }>(
              `SELECT id FROM reports WHERE type = 'flash' AND created_at > $1 LIMIT 1`,
              [fourHoursAgo],
            )
          ).rows,
      );
      if (existingFlash.length > 0) {
        log.info({ existingId: existingFlash[0].id }, 'Flash report already exists in last 4h, skipping');
        return null;
      }

      const timezone =
        (await loadContextOrDefault<string | null>('flash synthesis timezone', 'Asia/Jakarta', () =>
          getAppConfig(pool, 'timezone'),
        )) ?? 'Asia/Jakarta';
      const { dateString } = getTodayWindow(timezone);

      const prompt = prepareBudgetedSynthesisPrompt({
        llm,
        log,
        model: config.models.thinkalot,
        systemPrompt: FLASH_SYSTEM_PROMPT,
        maxTokens: 2000,
        label: 'Flash synthesis',
        summaries: relevant,
        minSummaryCount: 1,
        buildUserMessage: (candidateSummaries) => buildFlashUserMessage(candidateSummaries, correlatedEntities),
      });
      if (!prompt) return null;

      const relevantSummaries = prompt.summaries;

      log.info(
        {
          entities: correlatedEntities.length,
          summaries: relevantSummaries.length,
          estimatedInputTokens: prompt.estimatedInputTokens,
          inputBudget: prompt.inputBudget,
        },
        'Sending flash synthesis to LLM',
      );

      const report = await callReportWithRetry(
        llm,
        log,
        config.models.thinkalot,
        FLASH_SYSTEM_PROMPT,
        prompt.wrappedContent,
        2000,
        'synthesize',
        'Flash synthesis',
      );
      if (!report) return null;

      // Insert into DB
      const reportId = ulid();
      const avgSentiment = computeAvgSentiment(report);
      const sourceFamilies = [...new Set(relevantSummaries.map((s) => s.row.source))].sort();

      let reportRow: ReportRow;
      try {
        reportRow = await insertReport(pool, {
          id: reportId,
          date: dateString,
          type: 'flash',
          body: JSON.stringify({ ...report, sourceFamilies }),
          tldr: report.tldr,
          sentiment: avgSentiment,
          createdAt: Date.now(),
        });
      } catch (err: unknown) {
        // Unique constraint violation (23505) means a concurrent flash was created first
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
          log.info({ date: dateString }, 'Flash report race: another process created it first');
          return null;
        }
        throw err;
      }

      log.info({ reportId, entities: correlatedEntities.map((c) => c.entityName) }, 'Flash report created');

      return reportRow;
    } catch (err: unknown) {
      const loggedErr = toLoggedError(err);
      await recordFlashAbort(loggedErr);
      throw loggedErr;
    }
  }

  return { runDaily, runFlash };
}
