import { buildFocusedRawFeedContextActions, buildFocusedRawFeedPrimaryActions } from '../lib/rawMessageActions';
import { buildRawFeedFocusHref, buildRawFeedSourceHref, buildRawItemHref } from '../lib/rawFeedNavigation';
import { buildRawMessageFooterMeta, formatAbsoluteDateTime } from '../lib/rawMessages';
import type { FocusedRawFeedContext } from '../lib/useFocusedRawFeed';
import { RawCitationNavLinks } from './RawCitationNavLinks';
import { RawCitationPanelHeader } from './RawCitationPanelHeader';
import { RawCitationSurface } from './RawCitationSurface';
import { RawContextWindowControls } from './RawContextWindowControls';
import { RawItemHeader } from './RawItemHeader';
import { RawItemMetadataGrid } from './RawItemMetadataGrid';
import { RawMessageContextSection } from './RawMessageContextSection';
import { RawMessageCard } from './RawMessageCard';
import { RawTimelineDivider } from './RawTimelineDivider';

interface FocusedRawFeedPanelProps {
  focusedContext: FocusedRawFeedContext | null;
  focusedContextError?: string | null;
  focusedContextLoading: boolean;
  focusedGapLabel: string;
  contextSize: number;
  feedContextSize?: number;
  itemContextSize?: number;
  requestedSource: string;
  requestedSourceId: string;
  selectedSource: string;
  selectedSourceKind: string;
  showTimelineGap?: boolean;
  canExpandContext?: boolean;
  onExpandContext?: () => void;
  onRetryContext?: () => void;
  formatTimestamp: (timestamp: number) => string;
}

export function FocusedRawFeedPanel({
  focusedContext,
  focusedContextError = null,
  focusedContextLoading,
  focusedGapLabel,
  contextSize,
  feedContextSize,
  itemContextSize,
  requestedSource,
  requestedSourceId,
  selectedSource,
  selectedSourceKind,
  showTimelineGap = false,
  canExpandContext = false,
  onExpandContext,
  onRetryContext,
  formatTimestamp,
}: FocusedRawFeedPanelProps) {
  const previousItem = focusedContext?.older[focusedContext.older.length - 1];
  const nextItem = focusedContext?.newer[0];

  return (
    <>
      <RawCitationSurface>
        <RawCitationPanelHeader
          title="Focused Citation"
          description="This cited message is older than the current live page, so it is pinned here with nearby context from the same source."
          aside={
            <RawCitationNavLinks
              links={[
                ...(focusedContext
                  ? [
                      {
                        href: buildRawItemHref(focusedContext.item.id, { contextSize: itemContextSize }),
                        label: 'Open raw item',
                      },
                    ]
                  : []),
                ...(requestedSourceId
                  ? [{ href: buildRawFeedSourceHref(requestedSource, requestedSourceId), label: 'Resume live feed' }]
                  : []),
              ]}
              metaLabel={focusedContext?.item.sourceId || requestedSourceId || undefined}
              align="end"
            />
          }
        />

        {focusedContextLoading && !focusedContext && (
          <div className="text-sm text-text-secondary font-body">Loading focused citation context...</div>
        )}

        {focusedContextError && !focusedContext && (
          <div className="flex items-center gap-3 flex-wrap rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-3 text-sm text-accent-red font-body">
            <span>{focusedContextError}</span>
            {onRetryContext ? (
              <button
                type="button"
                onClick={onRetryContext}
                className="text-xs font-mono uppercase tracking-wider hover:underline"
              >
                Retry context
              </button>
            ) : null}
          </div>
        )}

        {focusedContext && (
          <div className="space-y-5">
            <RawContextWindowControls
              contextSize={contextSize}
              error={focusedContextError}
              loading={focusedContextLoading}
              canExpandContext={canExpandContext}
              onExpandContext={onExpandContext}
              onRetryContext={onRetryContext}
            />
            <RawItemHeader
              source={focusedContext.item.source}
              label="Pinned Citation"
              timestampLabel={formatTimestamp(focusedContext.item.timestamp)}
              previousHref={
                previousItem
                  ? buildRawFeedFocusHref(selectedSourceKind, selectedSource, previousItem.id, {
                      contextSize: feedContextSize,
                    })
                  : undefined
              }
              nextHref={
                nextItem
                  ? buildRawFeedFocusHref(selectedSourceKind, selectedSource, nextItem.id, {
                      contextSize: feedContextSize,
                    })
                  : undefined
              }
            />
            <RawMessageContextSection
              title="Earlier"
              items={focusedContext.older}
              formatTimestamp={formatTimestamp}
              getBadges={(item) => [{ label: item.status }]}
              getFooterMeta={(item) => buildRawMessageFooterMeta({ attachments: item.attachments })}
              getActions={(item) =>
                buildFocusedRawFeedContextActions(selectedSourceKind, selectedSource, item, {
                  feedContextSize,
                  itemContextSize,
                })
              }
              getCountLabel={(count) => `${count} item(s)`}
              imageAltPrefix="Feed attachment"
            />
            <RawMessageCard
              author={focusedContext.item.author}
              timestampLabel={formatTimestamp(focusedContext.item.timestamp)}
              content={focusedContext.item.content}
              attachments={focusedContext.item.attachments}
              badges={[{ label: 'Focused citation', tone: 'accent' }, { label: focusedContext.item.status }]}
              highlighted
              footerMeta={buildRawMessageFooterMeta({ attachments: focusedContext.item.attachments })}
              actions={buildFocusedRawFeedPrimaryActions(focusedContext.item, { itemContextSize })}
              imageAltPrefix="Feed attachment"
            />
            <RawMessageContextSection
              title="Later"
              items={focusedContext.newer}
              formatTimestamp={formatTimestamp}
              getBadges={(item) => [{ label: item.status }]}
              getFooterMeta={(item) => buildRawMessageFooterMeta({ attachments: item.attachments })}
              getActions={(item) =>
                buildFocusedRawFeedContextActions(selectedSourceKind, selectedSource, item, {
                  feedContextSize,
                  itemContextSize,
                })
              }
              getCountLabel={(count) => `${count} item(s)`}
              imageAltPrefix="Feed attachment"
            />
            <RawItemMetadataGrid
              sourceId={focusedContext.item.sourceId}
              createdAtLabel={formatAbsoluteDateTime(focusedContext.item.createdAt)}
              translated={focusedContext.item.translated}
              originalLanguage={focusedContext.item.originalLanguage}
              filterReason={focusedContext.item.filterReason}
            />
          </div>
        )}
      </RawCitationSurface>

      {showTimelineGap && <RawTimelineDivider label={focusedGapLabel} />}
    </>
  );
}
