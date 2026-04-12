import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';

import { Badge } from '../components/Badge.js';
import { EmptyState } from '../components/EmptyState.js';
import { EntityLink } from '../components/EntityLink.js';
import { LoadingSkeleton } from '../components/LoadingSkeleton.js';
import { SentimentIndicator } from '../components/SentimentIndicator.js';
import { Sparkline } from '../components/Sparkline.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { apiFetch, isApiError } from '../lib/api.js';
import { formatDateTime, sentimentTextColor } from '../lib/formatting.js';
import {
  ENTITY_RELATIONSHIP_GRAPH_STYLES,
  ENTITY_RELATIONSHIP_SOURCE_STYLES,
  MAX_ENTITY_GRAPH_CONNECTIONS,
  buildEntityRelationshipGraphConnections,
  formatCompactNumber,
  formatEntityRelationshipSource,
  formatEntityRelationshipType,
  getEntityRelationshipConnectionSummary,
  getEntityRelationshipGraphPosition,
  getRelatedEntityId,
  getRelatedEntityName,
} from './Settings/formatters.js';
import type {
  EntityAlias,
  EntityDivergence,
  EntityPriceData,
  EntityPriceSnapshot,
  EntityRelationship,
  EntityRelationshipGraphConnection,
  EntityRelationshipGraphData,
} from './Settings/types.js';

interface EntityProfile {
  id: string;
  name: string;
  type: string;
  status: string;
  relevance: number;
  firstSeen: number;
  lastSeen: number;
  mentionCount: number;
  aliases: string[];
}

interface EntityMentionResponse {
  id: string;
  summaryId: string | null;
  sentiment: number | null;
  mentionCount: number;
  createdAt: number;
  source: string;
}

interface EntityMentionList {
  total: number;
  mentions: EntityMentionRow[];
}

interface EntityMentionRow extends EntityMentionResponse {
  href: string | null;
  summaryText: string;
}

interface SummarySnippetResponse {
  summary: {
    id: string;
    text: string;
  };
}

interface QueryState<T> {
  loading: boolean;
  error: string | null;
  data: T | null;
}

const CARD_CLASSES = 'rounded-2xl border border-border bg-surface overflow-hidden';
const SOURCE_BADGE_CLASSES: Record<string, string> = {
  discord: 'bg-accent/20 text-accent',
  twitter: 'bg-accent-orange/20 text-accent-orange',
  rss: 'bg-accent-green/20 text-accent-green',
  news: 'bg-border text-text-secondary',
};

function createLoadingState<T>(): QueryState<T> {
  return { loading: true, error: null, data: null };
}

function createResolvedState<T>(data: T): QueryState<T> {
  return { loading: false, error: null, data };
}

function createErrorState<T>(error: string, data: T | null = null): QueryState<T> {
  return { loading: false, error, data };
}

function formatEntityType(type: string): string {
  return type
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatPriceUsd(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 1 ? 6 : 2,
  })}`;
}

function formatPercentChange(value: number | null, digits = 1): string {
  if (value == null || Number.isFinite(value) === false) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function getSignedColorClass(value: number | null): string {
  if (value == null) return 'text-text-secondary';
  return value >= 0 ? 'text-accent-green' : 'text-accent-red';
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function formatSourceLabel(source: string): string {
  if (source === 'twitter') return 'Twitter/X';
  return source.charAt(0).toUpperCase() + source.slice(1);
}

function collapseSummaryText(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 180) return collapsed;
  return `${collapsed.slice(0, 177)}...`;
}

function getSectionErrorText(label: string): string {
  return `${label} could not be loaded.`;
}

function isApi404(error: unknown): boolean {
  return isApiError(error) && error.status === 404;
}

function buildMentionHref(summaryId: string | null): string | null {
  return summaryId ? `/summaries/${summaryId}` : null;
}

function resolveFallbackMentionText(mention: EntityMentionResponse): string {
  if (mention.summaryId) {
    return 'Summary details are unavailable for this mention.';
  }

  return `${mention.mentionCount} raw mention${mention.mentionCount === 1 ? '' : 's'} captured without a linked summary.`;
}

function getPriceSeries(priceData: EntityPriceData | null): EntityPriceSnapshot[] {
  if (priceData == null) return [];

  const uniqueById = new Map<string, EntityPriceSnapshot>();
  for (const snapshot of priceData.history) {
    uniqueById.set(snapshot.id, snapshot);
  }
  if (priceData.latest) {
    uniqueById.set(priceData.latest.id, priceData.latest);
  }

  return Array.from(uniqueById.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function getWindowChangePercent(series: EntityPriceSnapshot[]): number | null {
  if (series.length < 2) return null;

  const firstPrice = series[0].priceUsd;
  const lastPrice = series[series.length - 1].priceUsd;
  if (firstPrice <= 0) return null;

  return ((lastPrice - firstPrice) / firstPrice) * 100;
}

function getCurrentSentiment(divergence: EntityDivergence | null): number | null {
  if (divergence == null) return null;

  const weightedValues = [
    divergence.engSentiment != null && divergence.engMentions > 0
      ? { value: divergence.engSentiment, weight: divergence.engMentions }
      : null,
    divergence.indSentiment != null && divergence.indMentions > 0
      ? { value: divergence.indSentiment, weight: divergence.indMentions }
      : null,
  ].filter((entry): entry is { value: number; weight: number } => entry != null);

  if (weightedValues.length === 0) {
    if (divergence.engSentiment != null) return divergence.engSentiment;
    if (divergence.indSentiment != null) return divergence.indSentiment;
    return null;
  }

  const totalWeight = weightedValues.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight === 0) return null;

  return weightedValues.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalWeight;
}

function describeRegionalSplit(divergence: EntityDivergence): string {
  if (divergence.engSentiment == null && divergence.indSentiment == null) {
    return 'Regional sentiment is not available yet.';
  }

  if (divergence.engSentiment == null || divergence.indSentiment == null) {
    return 'Only one language region has enough sentiment-bearing mentions right now.';
  }

  const delta = divergence.engSentiment - divergence.indSentiment;
  if (Math.abs(delta) < 0.15) {
    return 'English and Indonesian discussion are broadly aligned.';
  }

  return delta > 0
    ? 'English-language discussion is more constructive than Indonesian discussion.'
    : 'Indonesian discussion is more constructive than English-language discussion.';
}

function extractSecondDegreeCount(graphData: EntityRelationshipGraphData | null): number {
  if (graphData == null) return 0;
  return graphData.nodes.filter((node) => node.depth === 2).length;
}

async function loadMentionList(entityId: string): Promise<EntityMentionList> {
  const response = await apiFetch<{ mentions: EntityMentionResponse[]; total: number }>(
    `/entities/${entityId}/mentions?limit=10`,
  );

  const mentions = await Promise.allSettled(
    response.mentions.map(async (mention): Promise<EntityMentionRow> => {
      if (mention.summaryId == null) {
        return {
          ...mention,
          href: null,
          summaryText: resolveFallbackMentionText(mention),
        };
      }

      try {
        const summaryResponse = await apiFetch<SummarySnippetResponse>(`/summaries/${mention.summaryId}`);
        return {
          ...mention,
          href: buildMentionHref(mention.summaryId),
          summaryText: collapseSummaryText(summaryResponse.summary.text),
        };
      } catch {
        return {
          ...mention,
          href: buildMentionHref(mention.summaryId),
          summaryText: resolveFallbackMentionText(mention),
        };
      }
    }),
  );

  return {
    total: response.total,
    mentions: mentions.map((result, index) =>
      result.status === 'fulfilled'
        ? result.value
        : {
            ...response.mentions[index],
            href: buildMentionHref(response.mentions[index].summaryId),
            summaryText: resolveFallbackMentionText(response.mentions[index]),
          },
    ),
  };
}

function SectionHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
      <div className="space-y-1">
        <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-text-secondary">{title}</h2>
        {description ? <p className="text-sm text-text-secondary font-body">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div className={`${CARD_CLASSES} px-6 py-6`}>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_20rem]">
        <div className="space-y-4">
          <LoadingSkeleton className="h-3 w-28" />
          <LoadingSkeleton className="h-10 w-56" />
          <div className="flex flex-wrap gap-2">
            <LoadingSkeleton className="h-6 w-20 rounded-full" />
            <LoadingSkeleton className="h-6 w-24 rounded-full" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <LoadingSkeleton variant="card" className="h-20" />
            <LoadingSkeleton variant="card" className="h-20" />
            <LoadingSkeleton variant="card" className="h-20" />
          </div>
        </div>
        <LoadingSkeleton variant="card" className="h-56" />
      </div>
    </div>
  );
}

function SectionSkeleton({ includeRows = false }: { includeRows?: boolean }) {
  return (
    <div className="p-5 space-y-4">
      <LoadingSkeleton variant="card" className="h-36" />
      {includeRows ? (
        <>
          <LoadingSkeleton className="h-12 rounded-xl" />
          <LoadingSkeleton className="h-12 rounded-xl" />
          <LoadingSkeleton className="h-12 rounded-xl" />
        </>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <LoadingSkeleton variant="card" className="h-28" />
          <LoadingSkeleton variant="card" className="h-28" />
        </div>
      )}
    </div>
  );
}

function InlineSectionError({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm font-body text-accent-red">
      {message}
    </div>
  );
}

function HeaderStats({ entity }: { entity: EntityProfile }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-border bg-background/60 px-4 py-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary">Mentions</div>
        <div className="mt-2 text-lg font-heading text-text-primary">{entity.mentionCount.toLocaleString('en-US')}</div>
        <div className="mt-1 text-xs font-body text-text-secondary">All-time summary-linked mentions</div>
      </div>
      <div className="rounded-xl border border-border bg-background/60 px-4 py-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary">First Seen</div>
        <div className="mt-2 text-sm font-body text-text-primary">{formatDateTime(entity.firstSeen)}</div>
        <div className="mt-1 text-xs font-body text-text-secondary">Initial appearance in tracked sources</div>
      </div>
      <div className="rounded-xl border border-border bg-background/60 px-4 py-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary">Last Seen</div>
        <div className="mt-2 text-sm font-body text-text-primary">{formatDateTime(entity.lastSeen)}</div>
        <div className="mt-1 text-xs font-body text-text-secondary">
          Relevance {Math.round(entity.relevance * 100)}%
        </div>
      </div>
    </div>
  );
}

function HeaderPriceCard({
  priceState,
  priceSeries,
}: {
  priceState: QueryState<EntityPriceData>;
  priceSeries: EntityPriceSnapshot[];
}) {
  if (priceState.loading) {
    return <LoadingSkeleton variant="card" className="h-56" />;
  }

  if (priceState.error || priceState.data?.latest == null) {
    return (
      <div className="flex h-full min-h-56 flex-col justify-between rounded-2xl border border-border bg-background/60 p-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary">Latest Price</div>
          <div className="mt-3 text-lg font-heading text-text-primary">No live pricing</div>
          <p className="mt-2 text-sm font-body text-text-secondary">
            {priceState.error ?? 'This entity does not have tracked price history yet.'}
          </p>
        </div>
      </div>
    );
  }

  const latest = priceState.data.latest;
  const sparklineData = priceSeries.map((snapshot) => ({
    x: snapshot.timestamp,
    y: snapshot.priceUsd,
  }));

  return (
    <div className="relative min-h-56 overflow-hidden rounded-2xl border border-accent/20 bg-[radial-gradient(circle_at_top_right,rgba(77,171,247,0.16),transparent_58%),linear-gradient(180deg,rgba(18,20,28,0.92),rgba(12,13,18,0.92))] p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary">Latest Price</div>
      <div className="mt-3 flex items-end gap-3">
        <div className="text-3xl font-heading text-text-primary">{formatPriceUsd(latest.priceUsd)}</div>
        {latest.priceChange24h != null ? (
          <div className={`pb-1 text-sm font-mono ${getSignedColorClass(latest.priceChange24h)}`}>
            {formatPercentChange(latest.priceChange24h)} 24h
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-mono uppercase tracking-wide">
        {latest.priceChange7d != null ? (
          <span
            className={`rounded-full border px-2 py-1 ${getSignedColorClass(latest.priceChange7d)} border-current/20`}
          >
            {formatPercentChange(latest.priceChange7d)} 7d
          </span>
        ) : null}
        <span className="rounded-full border border-border bg-background/60 px-2 py-1 text-text-secondary">
          {priceSeries.length} point{priceSeries.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="mt-6 rounded-xl border border-border/80 bg-background/50 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-body text-text-secondary">30d drift</div>
          <Sparkline data={sparklineData} width={140} height={40} />
        </div>
        <div className="mt-3 text-[11px] font-mono uppercase tracking-wide text-text-secondary">
          Updated {formatDateTime(latest.timestamp)}
        </div>
      </div>
    </div>
  );
}

function PriceHistoryChart({ series }: { series: EntityPriceSnapshot[] }) {
  if (series.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-background/60 p-6 text-sm font-body text-text-secondary">
        No chart points available.
      </div>
    );
  }

  const width = 640;
  const height = 260;
  const padding = { top: 18, right: 18, bottom: 34, left: 54 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const minPrice = Math.min(...series.map((point) => point.priceUsd));
  const maxPrice = Math.max(...series.map((point) => point.priceUsd));
  const priceRange = maxPrice - minPrice || Math.max(maxPrice * 0.02, 1);
  const minTimestamp = series[0].timestamp;
  const maxTimestamp = series[series.length - 1].timestamp;
  const timeRange = maxTimestamp - minTimestamp || 1;

  const scaleX = (timestamp: number): number => padding.left + ((timestamp - minTimestamp) / timeRange) * innerWidth;
  const scaleY = (price: number): number => padding.top + innerHeight - ((price - minPrice) / priceRange) * innerHeight;

  const linePath = series
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${scaleX(point.timestamp)} ${scaleY(point.priceUsd)}`)
    .join(' ');
  const areaPath = `${linePath} L ${scaleX(series[series.length - 1].timestamp)} ${padding.top + innerHeight} L ${scaleX(
    series[0].timestamp,
  )} ${padding.top + innerHeight} Z`;
  const yTicks = [maxPrice, minPrice + priceRange / 2, minPrice];
  const xTicks = [series[0], series[Math.floor((series.length - 1) / 2)], series[series.length - 1]];

  return (
    <div className="rounded-xl border border-border bg-background/60 p-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="30 day price history">
        <defs>
          <linearGradient id="entity-price-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(77,171,247,0.36)" />
            <stop offset="100%" stopColor="rgba(77,171,247,0.02)" />
          </linearGradient>
        </defs>

        {yTicks.map((tick) => {
          const y = scaleY(tick);
          return (
            <g key={`grid-${tick}`}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="rgba(255,255,255,0.08)"
                strokeDasharray="4 6"
              />
              <text
                x={padding.left - 10}
                y={y + 4}
                textAnchor="end"
                className="fill-current text-[10px] text-text-secondary"
              >
                {formatPriceUsd(tick)}
              </text>
            </g>
          );
        })}

        <path d={areaPath} fill="url(#entity-price-fill)" />
        <path
          d={linePath}
          fill="none"
          stroke="#4dabf7"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {series.map((point, index) => {
          if (index !== 0 && index !== series.length - 1 && index !== Math.floor((series.length - 1) / 2)) {
            return null;
          }

          return (
            <circle
              key={point.id}
              cx={scaleX(point.timestamp)}
              cy={scaleY(point.priceUsd)}
              r="4"
              fill="#0f1118"
              stroke="#4dabf7"
              strokeWidth="2"
            />
          );
        })}

        {xTicks.map((point) => (
          <text
            key={`tick-${point.id}`}
            x={scaleX(point.timestamp)}
            y={height - 8}
            textAnchor="middle"
            className="fill-current text-[10px] text-text-secondary"
          >
            {new Date(point.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </text>
        ))}
      </svg>
    </div>
  );
}

function PriceStat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <div className="rounded-xl border border-border bg-background/60 px-4 py-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary">{label}</div>
      <div
        className={`mt-2 text-lg font-heading ${
          tone === 'positive' ? 'text-accent-green' : tone === 'negative' ? 'text-accent-red' : 'text-text-primary'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function RegionalSentimentBar({ label, value, mentions }: { label: string; value: number | null; mentions: number }) {
  const percentage = value == null ? 0 : Math.min(Math.abs(value), 1) * 50;
  const isPositive = (value ?? 0) >= 0;

  return (
    <div className="space-y-2 rounded-xl border border-border bg-background/60 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-body text-text-primary">{label}</div>
          <div className="text-xs font-body text-text-secondary">{mentions} sentiment-bearing mentions</div>
        </div>
        <div className={value == null ? 'text-text-secondary' : sentimentTextColor(value)}>
          {value == null ? 'n/a' : formatPercentChange(value * 100, 0).replace('%', '')}
        </div>
      </div>
      <div className="relative h-3 overflow-hidden rounded-full border border-border bg-surface-raised">
        <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
        {value != null ? (
          <div
            className={`absolute inset-y-0 ${isPositive ? 'left-1/2 bg-accent-green' : 'right-1/2 bg-accent-red'}`}
            style={{ width: `${percentage}%` }}
          />
        ) : null}
      </div>
      <div className="text-[11px] font-mono uppercase tracking-wide text-text-secondary">
        {value == null ? 'No score' : `Score ${value.toFixed(2)}`}
      </div>
    </div>
  );
}

function RelationshipOrbit({
  entity,
  connections,
  secondDegreeCount,
}: {
  entity: EntityProfile;
  connections: EntityRelationshipGraphConnection[];
  secondDegreeCount: number;
}) {
  if (connections.length === 0) {
    return (
      <div className="p-5">
        <EmptyState
          title="No relationship graph yet"
          description="Once this entity has direct links, they will appear here as a first-pass neighborhood map."
        />
      </div>
    );
  }

  const visibleConnections = connections.slice(0, MAX_ENTITY_GRAPH_CONNECTIONS);
  const hiddenConnections = Math.max(0, connections.length - visibleConnections.length);
  const activeConnections = connections.filter((connection) => !connection.isEnded).length;
  const evidenceConnections = connections.filter((connection) => connection.hasEvidence).length;

  return (
    <div className="p-5 space-y-4">
      <div className="flex flex-wrap gap-2 text-[11px] font-mono uppercase tracking-wide">
        <span className="rounded-full border border-border bg-background px-2 py-1 text-text-secondary">
          {activeConnections} active
        </span>
        <span className="rounded-full border border-border bg-background px-2 py-1 text-text-secondary">
          {evidenceConnections} with evidence
        </span>
        {secondDegreeCount > 0 ? (
          <span className="rounded-full border border-border bg-background px-2 py-1 text-text-secondary">
            {secondDegreeCount} in 2-hop context
          </span>
        ) : null}
        {hiddenConnections > 0 ? (
          <span className="rounded-full border border-border bg-background px-2 py-1 text-text-secondary">
            +{hiddenConnections} hidden
          </span>
        ) : null}
      </div>

      <div className="relative h-[360px] overflow-hidden rounded-xl border border-border bg-background">
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(circle at center, rgba(77,171,247,0.12), transparent 58%)' }}
          aria-hidden="true"
        />
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {visibleConnections.map((connection, index) => {
            const position = getEntityRelationshipGraphPosition(index, visibleConnections.length);
            const style = ENTITY_RELATIONSHIP_GRAPH_STYLES[connection.primaryRelationship.relationshipType];
            return (
              <line
                key={`edge-${connection.relatedEntityId}`}
                x1="50"
                y1="50"
                x2={position.x}
                y2={position.y}
                stroke={style.lineColor}
                strokeWidth={connection.primaryRelationship.source === 'manual' ? 1.8 : 1.5}
                strokeOpacity={connection.isEnded ? 0.35 : 0.82}
                strokeDasharray={connection.isEnded ? '3 2' : undefined}
              />
            );
          })}
        </svg>

        <div className="absolute left-1/2 top-1/2 z-10 w-40 max-w-[48vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-accent/25 bg-surface px-4 py-3 text-center shadow-[0_12px_36px_rgba(0,0,0,0.22)]">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary">Root</div>
          <div className="mt-1 text-sm font-heading leading-tight text-text-primary">{entity.name}</div>
          <div className="mt-2 text-[11px] font-body text-text-secondary">
            {connections.length} linked {connections.length === 1 ? 'entity' : 'entities'}
          </div>
        </div>

        {visibleConnections.map((connection, index) => {
          const position = getEntityRelationshipGraphPosition(index, visibleConnections.length);
          const style = ENTITY_RELATIONSHIP_GRAPH_STYLES[connection.primaryRelationship.relationshipType];

          return (
            <Link
              key={connection.relatedEntityId}
              to={`/entities/${connection.relatedEntityId}`}
              aria-label={`Inspect ${connection.relatedEntityName}`}
              className="absolute z-10 w-[6.75rem] -translate-x-1/2 -translate-y-1/2 rounded-xl border px-3 py-2 text-left shadow-[0_10px_30px_rgba(0,0,0,0.18)] transition-transform hover:-translate-y-[52%] focus:outline-none focus:ring-2 focus:ring-accent/60 sm:w-32"
              style={{
                left: `${position.x}%`,
                top: `${position.y}%`,
                borderColor: style.borderColor,
                backgroundColor: style.surfaceColor,
              }}
            >
              <div className="text-sm font-body leading-tight text-text-primary">{connection.relatedEntityName}</div>
              <div className="mt-1 text-[10px] font-mono uppercase tracking-wide text-text-secondary">
                {getEntityRelationshipConnectionSummary(connection)}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide"
                  style={{ backgroundColor: style.badgeBackground, color: style.badgeText }}
                >
                  {formatEntityRelationshipType(connection.primaryRelationship.relationshipType)}
                </span>
                {connection.isEnded ? (
                  <span className="rounded-full border border-border bg-background/70 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-text-secondary">
                    Ended
                  </span>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function NotFoundState({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <Link
        to="/settings"
        className="inline-block text-xs font-mono uppercase tracking-wide text-text-secondary hover:text-accent"
      >
        &larr; Settings / Entities
      </Link>
      <div className="rounded-2xl border border-border bg-surface px-6 py-8">
        <p className="text-base font-body text-accent-red">{message}</p>
      </div>
    </div>
  );
}

export function EntityDetail() {
  const { id } = useParams<{ id: string }>();
  const [entityState, setEntityState] = useState<QueryState<EntityProfile>>(createLoadingState());
  const [priceState, setPriceState] = useState<QueryState<EntityPriceData>>(createLoadingState());
  const [divergenceState, setDivergenceState] = useState<QueryState<EntityDivergence>>(createLoadingState());
  const [graphState, setGraphState] = useState<QueryState<EntityRelationshipGraphData>>(createLoadingState());
  const [relationshipsState, setRelationshipsState] = useState<QueryState<EntityRelationship[]>>(createLoadingState());
  const [mentionsState, setMentionsState] = useState<QueryState<EntityMentionList>>(createLoadingState());
  const [aliasesState, setAliasesState] = useState<QueryState<EntityAlias[]>>(createLoadingState());
  const [competitorsState, setCompetitorsState] = useState<QueryState<EntityRelationship[]>>(createLoadingState());
  const [entityNotFound, setEntityNotFound] = useState(false);
  const [prevId, setPrevId] = useState(id);

  if (id !== prevId) {
    setPrevId(id);
    setEntityNotFound(false);
    setEntityState(createLoadingState());
    setPriceState(createLoadingState());
    setDivergenceState(createLoadingState());
    setGraphState(createLoadingState());
    setRelationshipsState(createLoadingState());
    setMentionsState(createLoadingState());
    setAliasesState(createLoadingState());
    setCompetitorsState(createLoadingState());
  }

  useEffect(() => {
    if (!id) {
      return;
    }

    let cancelled = false;

    const loadEntity = apiFetch<{ entity: EntityProfile }>(`/entities/${id}`)
      .then((response) => {
        if (!cancelled) {
          setEntityState(createResolvedState(response.entity));
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isApi404(error)) {
          setEntityNotFound(true);
          setEntityState(createResolvedState<EntityProfile | null>(null) as QueryState<EntityProfile>);
          return;
        }
        setEntityState(createErrorState(getSectionErrorText('Entity details')));
      });

    const loadPrice = apiFetch<EntityPriceData>(`/entities/${id}/price?days=30`)
      .then((response) => {
        if (!cancelled) {
          setPriceState(createResolvedState(response));
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isApi404(error)) {
          setPriceState(createResolvedState<EntityPriceData | null>(null) as QueryState<EntityPriceData>);
          return;
        }
        setPriceState(createErrorState(getSectionErrorText('Price data')));
      });

    const loadDivergence = apiFetch<{ divergence: EntityDivergence }>(`/entities/${id}/divergence?days=7`)
      .then((response) => {
        if (!cancelled) {
          setDivergenceState(createResolvedState(response.divergence));
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isApi404(error)) {
          setDivergenceState(createResolvedState<EntityDivergence | null>(null) as QueryState<EntityDivergence>);
          return;
        }
        setDivergenceState(createErrorState(getSectionErrorText('Regional sentiment')));
      });

    const loadGraph = apiFetch<EntityRelationshipGraphData>(`/entities/${id}/graph`)
      .then((response) => {
        if (!cancelled) {
          setGraphState(createResolvedState(response));
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isApi404(error)) {
          setGraphState(
            createResolvedState<EntityRelationshipGraphData | null>(null) as QueryState<EntityRelationshipGraphData>,
          );
          return;
        }
        setGraphState(createErrorState(getSectionErrorText('Relationship graph')));
      });

    const loadRelationships = apiFetch<{ relationships: EntityRelationship[] }>(`/entities/${id}/relationships`)
      .then((response) => {
        if (!cancelled) {
          setRelationshipsState(createResolvedState(response.relationships));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRelationshipsState(createErrorState(getSectionErrorText('Relationships')));
        }
      });

    const loadMentions = loadMentionList(id)
      .then((response) => {
        if (!cancelled) {
          setMentionsState(createResolvedState(response));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMentionsState(createErrorState(getSectionErrorText('Recent mentions')));
        }
      });

    const loadAliases = apiFetch<{ aliases: EntityAlias[] }>(`/entities/${id}/aliases`)
      .then((response) => {
        if (!cancelled) {
          setAliasesState(createResolvedState(response.aliases));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAliasesState(createErrorState(getSectionErrorText('Aliases')));
        }
      });

    const loadCompetitors = apiFetch<{ competitors: EntityRelationship[] }>(`/entities/${id}/competitors`)
      .then((response) => {
        if (!cancelled) {
          setCompetitorsState(createResolvedState(response.competitors));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCompetitorsState(createErrorState(getSectionErrorText('Competitors')));
        }
      });

    void Promise.allSettled([
      loadEntity,
      loadPrice,
      loadDivergence,
      loadGraph,
      loadRelationships,
      loadMentions,
      loadAliases,
      loadCompetitors,
    ]);

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!id) {
    return <NotFoundState message="Entity not found." />;
  }

  if (entityState.loading && entityState.data == null) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <HeaderSkeleton />
        <div className={CARD_CLASSES}>
          <SectionHeading title="Price History" description="30 day line chart, latest snapshot, and window stats." />
          <SectionSkeleton />
        </div>
        <div className={CARD_CLASSES}>
          <SectionHeading title="Sentiment" description="Weighted current sentiment and EN vs ID comparison." />
          <SectionSkeleton />
        </div>
        <div className={CARD_CLASSES}>
          <SectionHeading
            title="Relationships"
            description="Connected entities, competitor pairs, and graph context."
          />
          <SectionSkeleton includeRows />
        </div>
        <div className={CARD_CLASSES}>
          <SectionHeading title="Recent Mentions" description="The latest summary-backed mentions for this entity." />
          <SectionSkeleton includeRows />
        </div>
      </div>
    );
  }

  if (entityNotFound) {
    return <NotFoundState message="Entity not found." />;
  }

  if (entityState.error || entityState.data == null) {
    return <NotFoundState message={entityState.error ?? 'Entity not found.'} />;
  }

  const entity = entityState.data;
  const priceSeries = getPriceSeries(priceState.data);
  const currentSentiment = getCurrentSentiment(divergenceState.data);
  const aliases =
    aliasesState.data ??
    entity.aliases.map((alias, index) => ({
      id: `fallback-${index}`,
      entityId: entity.id,
      alias,
      origin: 'unknown',
      createdAt: entity.firstSeen,
    }));
  const relationships = relationshipsState.data ?? [];
  const competitors = competitorsState.data ?? [];
  const graphConnections =
    relationships.length > 0 ? buildEntityRelationshipGraphConnections(entity.id, relationships) : [];
  const secondDegreeCount = extractSecondDegreeCount(graphState.data);
  const relationshipRows = [...relationships].sort(
    (left, right) => right.confidence - left.confidence || right.updatedAt - left.updatedAt,
  );
  const competitorRows = [...competitors].sort(
    (left, right) => right.confidence - left.confidence || right.updatedAt - left.updatedAt,
  );
  const windowChange = getWindowChangePercent(priceSeries);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className={`${CARD_CLASSES} relative overflow-hidden`}>
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(135deg, rgba(77,171,247,0.12), transparent 42%)' }}
          aria-hidden="true"
        />
        <div className="relative grid gap-6 px-6 py-6 xl:grid-cols-[minmax(0,1.25fr)_20rem]">
          <div className="space-y-5">
            <div className="space-y-3">
              <Link
                to="/settings"
                className="inline-block text-xs font-mono uppercase tracking-wide text-text-secondary hover:text-accent"
              >
                &larr; Settings / Entities
              </Link>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-4xl font-heading text-text-primary sm:text-5xl">{entity.name}</h1>
                <StatusBadge status={entity.status} />
                {entity.type ? (
                  <Badge
                    label={formatEntityType(entity.type)}
                    colorClass="border border-accent/20 bg-accent/10 text-accent"
                  />
                ) : null}
              </div>
              <p className="max-w-2xl text-sm font-body leading-6 text-text-secondary">
                Detail page for one tracked entity across pricing, sentiment, connected entities, and summary-level
                references.
              </p>
            </div>

            <HeaderStats entity={entity} />
          </div>

          <HeaderPriceCard priceState={priceState} priceSeries={priceSeries} />
        </div>
      </div>

      {(priceState.loading || priceState.error != null || priceState.data != null) && (
        <section className={CARD_CLASSES}>
          <SectionHeading
            title="Price History"
            description="30 day line chart, latest snapshot, and trailing window stats."
          />
          {priceState.loading ? (
            <SectionSkeleton />
          ) : priceState.error ? (
            <div className="p-5">
              <InlineSectionError message={priceState.error} />
            </div>
          ) : priceState.data ? (
            <div className="space-y-5 p-5">
              <PriceHistoryChart series={priceSeries} />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <PriceStat
                  label="Market Cap"
                  value={
                    priceState.data.latest?.marketCap != null
                      ? `$${formatCompactNumber(priceState.data.latest.marketCap)}`
                      : 'n/a'
                  }
                />
                <PriceStat
                  label="24h Volume"
                  value={
                    priceState.data.latest?.volume24h != null
                      ? `$${formatCompactNumber(priceState.data.latest.volume24h)}`
                      : 'n/a'
                  }
                />
                <PriceStat
                  label="7d Change"
                  value={formatPercentChange(priceState.data.latest?.priceChange7d ?? null)}
                  tone={
                    (priceState.data.latest?.priceChange7d ?? 0) > 0
                      ? 'positive'
                      : (priceState.data.latest?.priceChange7d ?? 0) < 0
                        ? 'negative'
                        : 'neutral'
                  }
                />
                <PriceStat
                  label="30d Change"
                  value={formatPercentChange(windowChange)}
                  tone={
                    windowChange != null && windowChange > 0
                      ? 'positive'
                      : windowChange != null && windowChange < 0
                        ? 'negative'
                        : 'neutral'
                  }
                />
              </div>
            </div>
          ) : null}
        </section>
      )}

      <section className={CARD_CLASSES}>
        <SectionHeading
          title="Sentiment"
          description="Weighted current sentiment plus English and Indonesian divergence."
        />
        {divergenceState.loading ? (
          <SectionSkeleton />
        ) : divergenceState.error ? (
          <div className="p-5">
            <InlineSectionError message={divergenceState.error} />
          </div>
        ) : divergenceState.data == null ? (
          <div className="p-5">
            <EmptyState
              title="No sentiment data yet"
              description="This entity has not accumulated enough sentiment-bearing mentions for a regional split."
            />
          </div>
        ) : (
          <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
            <div className="rounded-2xl border border-border bg-background/60 px-5 py-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary">Current Tone</div>
              <div className="mt-5 inline-block origin-left scale-[1.9]">
                {currentSentiment != null ? (
                  <SentimentIndicator value={currentSentiment} />
                ) : (
                  <span className="font-mono text-sm text-text-secondary">n/a</span>
                )}
              </div>
              <div className="mt-5 flex flex-wrap gap-2 text-[11px] font-mono uppercase tracking-wide">
                <span className="rounded-full border border-border bg-surface-raised px-2 py-1 text-text-secondary">
                  {divergenceState.data.engMentions + divergenceState.data.indMentions} region-scored mentions
                </span>
                {divergenceState.data.divergence != null ? (
                  <span className="rounded-full border border-border bg-surface-raised px-2 py-1 text-text-secondary">
                    split {divergenceState.data.divergence.toFixed(2)}
                  </span>
                ) : null}
              </div>
              <p className="mt-5 text-sm font-body leading-6 text-text-secondary">
                {describeRegionalSplit(divergenceState.data)}
              </p>
            </div>

            <div className="space-y-3">
              <RegionalSentimentBar
                label="English"
                value={divergenceState.data.engSentiment}
                mentions={divergenceState.data.engMentions}
              />
              <RegionalSentimentBar
                label="Indonesian"
                value={divergenceState.data.indSentiment}
                mentions={divergenceState.data.indMentions}
              />
            </div>
          </div>
        )}
      </section>

      <section className={CARD_CLASSES}>
        <SectionHeading
          title="Relationships"
          description="Connected entities, competitor pairs, and first-pass graph context."
          action={
            relationshipsState.data ? (
              <span className="rounded-full border border-border bg-background px-3 py-1 text-[11px] font-mono uppercase tracking-wide text-text-secondary">
                {relationshipsState.data.length} mapped
              </span>
            ) : undefined
          }
        />
        <div className="space-y-5 p-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_22rem]">
            <div className="rounded-2xl border border-border bg-surface-raised/20">
              <div className="border-b border-border px-5 py-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary">Graph</div>
                <p className="mt-1 text-sm font-body text-text-secondary">Direct neighbors around {entity.name}.</p>
              </div>
              {graphState.loading || relationshipsState.loading ? (
                <SectionSkeleton />
              ) : graphState.error ? (
                <div className="p-5">
                  <InlineSectionError message={graphState.error} />
                </div>
              ) : (
                <RelationshipOrbit
                  entity={entity}
                  connections={graphConnections}
                  secondDegreeCount={secondDegreeCount}
                />
              )}
            </div>

            <div className="rounded-2xl border border-border bg-surface-raised/20">
              <div className="border-b border-border px-5 py-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary">Competitors</div>
                <p className="mt-1 text-sm font-body text-text-secondary">Direct `competes_with` mappings.</p>
              </div>
              {competitorsState.loading ? (
                <div className="p-5 space-y-3">
                  <LoadingSkeleton className="h-10 rounded-xl" />
                  <LoadingSkeleton className="h-10 rounded-xl" />
                  <LoadingSkeleton className="h-10 rounded-xl" />
                </div>
              ) : competitorsState.error ? (
                <div className="p-5">
                  <InlineSectionError message={competitorsState.error} />
                </div>
              ) : competitorRows.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="No competitors mapped"
                    description="This entity does not have any direct competitor pairs yet."
                  />
                </div>
              ) : (
                <div className="space-y-3 p-5">
                  {competitorRows.map((relationship) => (
                    <div key={relationship.id} className="rounded-xl border border-border bg-background/60 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <EntityLink
                          entityId={getRelatedEntityId(relationship, entity.id)}
                          name={getRelatedEntityName(relationship, entity.id)}
                        />
                        <span className="text-xs font-mono text-text-secondary">
                          {formatConfidence(relationship.confidence)}
                        </span>
                      </div>
                      <div className="mt-2 text-[11px] font-body text-text-secondary">
                        {formatEntityRelationshipSource(relationship.source)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-surface-raised/20">
            <div className="border-b border-border px-5 py-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary">Connections</div>
              <p className="mt-1 text-sm font-body text-text-secondary">
                Entity, relationship type, source, and evidence trail when one exists.
              </p>
            </div>
            {relationshipsState.loading ? (
              <div className="p-5 space-y-3">
                <LoadingSkeleton className="h-14 rounded-xl" />
                <LoadingSkeleton className="h-14 rounded-xl" />
                <LoadingSkeleton className="h-14 rounded-xl" />
              </div>
            ) : relationshipsState.error ? (
              <div className="p-5">
                <InlineSectionError message={relationshipsState.error} />
              </div>
            ) : relationshipRows.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="No relationships found"
                  description="This entity has not accumulated any mapped cross-entity relationships yet."
                />
              </div>
            ) : (
              <div className="divide-y divide-border">
                {relationshipRows.map((relationship) => (
                  <div key={relationship.id} className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_12rem]">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <EntityLink
                          entityId={getRelatedEntityId(relationship, entity.id)}
                          name={getRelatedEntityName(relationship, entity.id)}
                        />
                        <Badge
                          label={formatEntityRelationshipType(relationship.relationshipType)}
                          colorClass="border border-border bg-background text-text-secondary"
                        />
                        <Badge
                          label={formatEntityRelationshipSource(relationship.source)}
                          colorClass={ENTITY_RELATIONSHIP_SOURCE_STYLES[relationship.source]}
                        />
                      </div>
                      <div className="text-sm font-body text-text-secondary">
                        Updated {formatDateTime(relationship.updatedAt)}
                        {relationship.sinceAt != null ? ` | since ${formatDateTime(relationship.sinceAt)}` : ''}
                        {relationship.untilAt != null ? ` | until ${formatDateTime(relationship.untilAt)}` : ''}
                      </div>
                      {relationship.summaryId ? (
                        <Link
                          to={`/summaries/${relationship.summaryId}`}
                          className="inline-flex text-xs font-mono uppercase tracking-wide text-accent hover:underline"
                        >
                          Open evidence summary
                        </Link>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-between gap-3 md:block md:text-right">
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary">
                        Confidence
                      </div>
                      <div className="mt-1 text-xl font-heading text-text-primary">
                        {formatConfidence(relationship.confidence)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className={CARD_CLASSES}>
        <SectionHeading
          title="Recent Mentions"
          description="The last 10 summary-backed mentions that reference this entity."
          action={
            mentionsState.data ? (
              <span className="rounded-full border border-border bg-background px-3 py-1 text-[11px] font-mono uppercase tracking-wide text-text-secondary">
                {mentionsState.data.total} total
              </span>
            ) : undefined
          }
        />
        {mentionsState.loading ? (
          <SectionSkeleton includeRows />
        ) : mentionsState.error ? (
          <div className="p-5">
            <InlineSectionError message={mentionsState.error} />
          </div>
        ) : mentionsState.data == null || mentionsState.data.mentions.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No recent mentions"
              description="This entity has not appeared in any recent summary windows yet."
            />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {mentionsState.data.mentions.map((mention) => {
              const content = (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      label={formatSourceLabel(mention.source)}
                      colorClass={SOURCE_BADGE_CLASSES[mention.source] ?? 'bg-border text-text-secondary'}
                    />
                    <span className="text-[11px] font-mono uppercase tracking-wide text-text-secondary">
                      {formatDateTime(mention.createdAt)}
                    </span>
                  </div>
                  <div className="mt-3 flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-body text-text-primary" title={mention.summaryText}>
                        {mention.summaryText}
                      </p>
                      <div className="mt-2 text-[11px] font-body text-text-secondary">
                        {mention.mentionCount} mention{mention.mentionCount === 1 ? '' : 's'} in captured source window
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary">
                        Sentiment
                      </div>
                      <div
                        className={`mt-1 text-sm font-mono ${mention.sentiment == null ? 'text-text-secondary' : sentimentTextColor(mention.sentiment)}`}
                      >
                        {mention.sentiment == null
                          ? 'n/a'
                          : `${mention.sentiment > 0 ? '+' : ''}${mention.sentiment.toFixed(2)}`}
                      </div>
                    </div>
                  </div>
                </>
              );

              return mention.href ? (
                <Link
                  key={mention.id}
                  to={mention.href}
                  className="block px-5 py-4 transition-colors hover:bg-surface-raised"
                >
                  {content}
                </Link>
              ) : (
                <div key={mention.id} className="px-5 py-4">
                  {content}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className={CARD_CLASSES}>
        <SectionHeading title="Known Aliases" description="Observed surface forms that resolve to this entity." />
        {aliasesState.loading && entity.aliases.length === 0 ? (
          <div className="p-5">
            <div className="flex flex-wrap gap-2">
              <LoadingSkeleton className="h-8 w-24 rounded-full" />
              <LoadingSkeleton className="h-8 w-20 rounded-full" />
              <LoadingSkeleton className="h-8 w-28 rounded-full" />
            </div>
          </div>
        ) : aliases.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No aliases recorded"
              description="Canonical naming is still the only known surface form for this entity."
            />
          </div>
        ) : (
          <div className="p-5">
            <div className="flex flex-wrap gap-2">
              {aliases.map((alias) => (
                <span
                  key={alias.id}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-sm font-body text-text-primary"
                >
                  {alias.alias}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
