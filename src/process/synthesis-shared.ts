import { z } from 'zod';
import { MarketReportLLMSchema } from './schemas.js';
import type { MarketReport } from './schemas.js';
import type { EventChainRow } from '../db/queries.js';

const ParsedSummaryBodySchema = z.object({
  summary: z.string(),
  urgency: z.string(),
  entities: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      sentiment: z.number(),
      mentionCount: z.number(),
    }),
  ),
  keyEvents: z.array(z.string()),
  confidence: z.number(),
});

export type ParsedSummaryBody = z.infer<typeof ParsedSummaryBodySchema>;

export function parseSummaryBody(body: string): ParsedSummaryBody | null {
  try {
    const raw: unknown = JSON.parse(body);
    const result = ParsedSummaryBodySchema.safeParse(raw);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// ── XML escaping ─────────────────────────────────────────────────────

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function formatCalendarEventTime(timestamp: number, timezone: string): string {
  const formatted = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  }).format(timestamp);
  return `${formatted} ${timezone}`;
}

export function formatEventChainLine(chain: EventChainRow, timezone: string): string {
  const timeline = chain.event_types.map((eventType) => escapeXml(eventType)).join(' -> ');
  const latestDescription = chain.descriptions[chain.descriptions.length - 1];
  const latestText = latestDescription ? ` | latest=${escapeXml(latestDescription)}` : '';
  return `${escapeXml(chain.entity_name)}: ${chain.event_count} linked events from ${formatCalendarEventTime(chain.first_event_time, timezone)} to ${formatCalendarEventTime(chain.latest_event_time, timezone)} | chain=${timeline}${latestText}`;
}

export type ReportParseResult =
  | { success: true; report: MarketReport }
  | { success: false; kind: 'json' | 'schema'; errorPaths?: string };

// ── Parse LLM response ───────────────────────────────────────────────

export function safeParseReportResponse(raw: string): ReportParseResult {
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { success: false, kind: 'json' };
  }

  const result = MarketReportLLMSchema.safeParse(parsed);
  if (result.success) {
    return { success: true, report: result.data };
  }

  const errorPaths = result.error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('; ');
  return { success: false, kind: 'schema', errorPaths };
}
