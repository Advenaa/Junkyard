import { useState } from 'react';
import { Link } from 'react-router';
import { buildFocusedReportHref, buildSummaryChainHref } from '../lib/reportChains';

export interface ChatSource {
  type: 'report' | 'summary' | 'item';
  id: string;
  label: string;
  snippet: string;
  dateLabel?: string;
  chainRootId?: string;
  chainLabel?: string;
}

interface ChatSourcesProps {
  sources: ChatSource[];
}

interface DisplayChatSource extends ChatSource {
  groupKey: string;
  sourceCount: number;
  relatedSources: ChatSource[];
}

interface RelatedChatSource {
  source: ChatSource;
  sourceIndex: number;
}

function getSourceGroupKey(source: ChatSource): string {
  return source.chainRootId && (source.type === 'report' || source.type === 'summary')
    ? `${source.type}:chain:${source.chainRootId}`
    : `${source.type}:id:${source.id}`;
}

function hrefForSource(source: ChatSource): string | null {
  if (source.type === 'report') {
    return source.chainRootId ? buildFocusedReportHref(source.id, source.chainRootId) : `/reports/${source.id}`;
  }
  if (source.type === 'summary') {
    return source.chainRootId ? buildSummaryChainHref(source.id, source.chainRootId) : `/summaries/${source.id}`;
  }
  if (source.type === 'item') {
    return `/items/${source.id}`;
  }
  return null;
}

function groupSources(sources: ChatSource[]): DisplayChatSource[] {
  const grouped = new Map<string, DisplayChatSource>();

  for (const source of sources) {
    const key = getSourceGroupKey(source);
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, {
        ...source,
        groupKey: key,
        sourceCount: 1,
        relatedSources: [source],
      });
      continue;
    }

    existing.sourceCount += 1;
    if (!existing.chainLabel && source.chainLabel) {
      existing.chainLabel = source.chainLabel;
    }
    if (
      !existing.relatedSources.some(
        (relatedSource) =>
          relatedSource.type === source.type &&
          relatedSource.id === source.id &&
          relatedSource.label === source.label &&
          relatedSource.snippet === source.snippet &&
          relatedSource.chainRootId === source.chainRootId,
      )
    ) {
      existing.relatedSources.push(source);
    }
  }

  return [...grouped.values()];
}

function getLeadIndex(source: DisplayChatSource, selectedLeadIndex?: number): number {
  if (
    typeof selectedLeadIndex === 'number' &&
    selectedLeadIndex >= 0 &&
    selectedLeadIndex < source.relatedSources.length
  ) {
    return selectedLeadIndex;
  }

  return 0;
}

function buildDisplaySource(source: DisplayChatSource, leadIndex: number): DisplayChatSource {
  const leadSource = source.relatedSources[leadIndex] ?? source.relatedSources[0] ?? source;
  const orderedSources = [leadSource, ...source.relatedSources.filter((_, sourceIndex) => sourceIndex !== leadIndex)];

  return {
    ...source,
    ...leadSource,
    relatedSources: orderedSources,
  };
}

function buildSingleSourceTitle(source: ChatSource): string {
  const parts: string[] = [];
  if (source.chainRootId) {
    parts.push(source.chainLabel ? `Focused chain: ${source.chainLabel}` : 'Focused chain');
  }
  parts.push(`${source.label}: ${source.snippet}`);
  return parts.join('\n');
}

function buildSourceTitle(source: DisplayChatSource): string {
  const parts: string[] = [];
  if (source.chainRootId) {
    parts.push(source.chainLabel ? `Focused chain: ${source.chainLabel}` : 'Focused chain');
  }
  if (source.sourceCount > 1) {
    parts.push(`Matches ${source.sourceCount} ${source.type} citations in this chain`);
  }
  parts.push(...source.relatedSources.map((relatedSource) => `${relatedSource.label}: ${relatedSource.snippet}`));
  return parts.join('\n');
}

function getRelativeCitationLabel(primaryDateLabel?: string, relatedDateLabel?: string): string | null {
  if (!primaryDateLabel || !relatedDateLabel) return null;
  if (primaryDateLabel === relatedDateLabel) return 'Same day';
  return relatedDateLabel > primaryDateLabel ? 'Later' : 'Earlier';
}

function renderSourceText(
  label: string,
  snippet?: string,
  compact = false,
  dateLabel?: string,
  relativeLabel?: string | null,
) {
  if (!snippet) {
    return <span>{label}</span>;
  }

  if (compact) {
    return (
      <span className="flex flex-col items-start gap-0.5 text-left">
        <span className="flex flex-wrap items-center gap-2">
          <span>{label}</span>
          {dateLabel ? (
            <span className="rounded-full border border-border bg-surface-raised px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-text-secondary">
              {dateLabel}
            </span>
          ) : null}
          {relativeLabel ? (
            <span className="rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-accent">
              {relativeLabel}
            </span>
          ) : null}
        </span>
        <span className="max-w-52 text-[11px] leading-relaxed text-text-tertiary line-clamp-2">{snippet}</span>
      </span>
    );
  }

  return <span>{label}</span>;
}

export function ChatSources({ sources }: ChatSourcesProps) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [leadIndices, setLeadIndices] = useState<Record<string, number>>({});
  if (sources.length === 0) return null;
  const displaySources = groupSources(sources);

  return (
    <div className="mt-2 space-y-1.5">
      <div className="text-[10px] font-mono uppercase tracking-wider text-text-secondary">Sources</div>
      <div className="flex flex-wrap items-start gap-2">
        {displaySources.map((source, index) => {
          const leadIndex = getLeadIndex(source, leadIndices[source.groupKey]);
          const displaySource = buildDisplaySource(source, leadIndex);
          const href = hrefForSource(displaySource);
          const title = buildSourceTitle(displaySource);
          const className =
            'inline-flex items-center gap-2 rounded-full border border-border bg-surface-raised px-3 py-1 text-xs text-text-secondary transition-colors hover:text-text-primary';
          const relatedClassName =
            'inline-flex max-w-xs items-start rounded-2xl border border-border bg-background px-3 py-2 text-xs text-text-secondary transition-colors hover:text-text-primary';
          const relatedActionClassName =
            'ml-2 text-[10px] font-mono uppercase tracking-wider text-accent hover:underline';
          const badge = displaySource.chainRootId ? (
            <span className="rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-accent">
              Focused chain
            </span>
          ) : null;
          const countBadge =
            displaySource.sourceCount > 1 ? (
              <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-text-secondary">
                {displaySource.sourceCount} cites
              </span>
            ) : null;
          const hiddenSources: RelatedChatSource[] = source.relatedSources
            .map((relatedSource, sourceIndex) => ({ source: relatedSource, sourceIndex }))
            .filter((relatedSource) => relatedSource.sourceIndex !== leadIndex);
          const showLeadAnchor = hiddenSources.length > 0;
          const leadDateBadge =
            showLeadAnchor && displaySource.dateLabel ? (
              <span className="rounded-full border border-border bg-surface-raised px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-text-secondary">
                {displaySource.dateLabel}
              </span>
            ) : null;
          const leadBadge = showLeadAnchor ? (
            <span className="rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-accent">
              Lead cite
            </span>
          ) : null;
          const canRevealRelatedSources = hiddenSources.length > 0;
          const isExpanded = canRevealRelatedSources && Boolean(expandedGroups[source.groupKey]);
          const relatedDisclosureId = `chat-source-related-${index}`;
          const toggleRelatedSources = () => {
            setExpandedGroups((current) => ({
              ...current,
              [displaySource.groupKey]: !current[displaySource.groupKey],
            }));
          };
          const makeLeadCitation = (sourceIndex: number) => {
            setLeadIndices((current) => ({
              ...current,
              [displaySource.groupKey]: sourceIndex,
            }));
          };

          return (
            <div key={displaySource.groupKey} className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                {href ? (
                  <Link to={href} title={title} className={className}>
                    {renderSourceText(displaySource.label)}
                    {leadDateBadge}
                    {badge}
                    {leadBadge}
                    {countBadge}
                  </Link>
                ) : (
                  <span title={title} className={className}>
                    {renderSourceText(displaySource.label)}
                    {leadDateBadge}
                    {badge}
                    {leadBadge}
                    {countBadge}
                  </span>
                )}
                {canRevealRelatedSources ? (
                  <button
                    type="button"
                    onClick={toggleRelatedSources}
                    aria-expanded={isExpanded}
                    aria-controls={relatedDisclosureId}
                    aria-label={`${isExpanded ? 'Hide' : 'Show'} related citations for ${displaySource.label}`}
                    className="text-xs font-mono uppercase tracking-wider text-accent hover:underline"
                  >
                    {isExpanded ? 'Hide related' : `Show ${hiddenSources.length} more`}
                  </button>
                ) : null}
              </div>
              {canRevealRelatedSources && isExpanded ? (
                <div id={relatedDisclosureId} className="ml-3 flex flex-wrap gap-2">
                  {hiddenSources.map(({ source: relatedSource, sourceIndex }, relatedIndex) => {
                    const relatedHref = hrefForSource(relatedSource);
                    const relatedTitle = buildSingleSourceTitle(relatedSource);
                    const relatedKey = `${source.groupKey}:related:${relatedIndex}`;
                    const relativeLabel = getRelativeCitationLabel(displaySource.dateLabel, relatedSource.dateLabel);

                    return (
                      <div key={relatedKey} className="flex flex-col items-start gap-1">
                        {relatedHref ? (
                          <Link to={relatedHref} title={relatedTitle} className={relatedClassName}>
                            {renderSourceText(
                              relatedSource.label,
                              relatedSource.snippet,
                              true,
                              relatedSource.dateLabel,
                              relativeLabel,
                            )}
                          </Link>
                        ) : (
                          <span title={relatedTitle} className={relatedClassName}>
                            {renderSourceText(
                              relatedSource.label,
                              relatedSource.snippet,
                              true,
                              relatedSource.dateLabel,
                              relativeLabel,
                            )}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => makeLeadCitation(sourceIndex)}
                          aria-label={`Make ${relatedSource.label} the lead citation`}
                          className={relatedActionClassName}
                        >
                          Make lead
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
