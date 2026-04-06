import { useParams, useSearchParams } from 'react-router';
import { RawItemHeader } from '../components/RawItemHeader';
import { RawItemContextPanel } from '../components/RawItemContextPanel';
import { RawItemMetadataGrid } from '../components/RawItemMetadataGrid';
import { RawMessageCard } from '../components/RawMessageCard';
import { RawCitationNavLinks } from '../components/RawCitationNavLinks';
import { RawCitationPanelHeader } from '../components/RawCitationPanelHeader';
import { RawItemRouteState } from '../components/RawItemRouteState';
import { RawCitationSurface } from '../components/RawCitationSurface';
import { RawTimelineDivider } from '../components/RawTimelineDivider';
import {
  buildRawFeedFocusHrefForItem,
  buildRawFeedSourceHrefForItem,
  buildRawItemHref,
  readRawRouteContextSize,
  toRawRouteContextParam,
} from '../lib/rawFeedNavigation';
import { buildRawItemDetailActions } from '../lib/rawMessageActions';
import { buildRawMessageFooterMeta, formatAbsoluteDateTime } from '../lib/rawMessages';
import { DEFAULT_FOCUSED_RAW_FEED_CONTEXT_SIZE, MAX_FOCUSED_RAW_FEED_CONTEXT_SIZE } from '../lib/useFocusedRawFeed';
import { DEFAULT_RAW_ITEM_CONTEXT_SIZE, MAX_RAW_ITEM_CONTEXT_SIZE, useRawItemView } from '../lib/useRawItemView';

const RAW_ITEM_CONTEXT_DIVIDER_LABEL = 'Nearby source context continues below';
const RAW_ITEM_CITATION_DESCRIPTION =
  'This raw source message is opened directly so you can inspect the exact cited item, move through adjacent source messages, and jump back into the feed timeline when needed.';

function formatDateTime(epochMs: number): string {
  return formatAbsoluteDateTime(epochMs);
}

export function ItemView() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const itemId = id ?? '';
  const contextSize = readRawRouteContextSize(
    searchParams.get('context'),
    DEFAULT_RAW_ITEM_CONTEXT_SIZE,
    MAX_RAW_ITEM_CONTEXT_SIZE,
  );
  const rawItemContextSize = toRawRouteContextParam(
    contextSize,
    DEFAULT_RAW_ITEM_CONTEXT_SIZE,
    MAX_RAW_ITEM_CONTEXT_SIZE,
  );
  const focusedFeedContextSize = toRawRouteContextParam(
    contextSize,
    DEFAULT_FOCUSED_RAW_FEED_CONTEXT_SIZE,
    MAX_FOCUSED_RAW_FEED_CONTEXT_SIZE,
  );
  const { item, contextItems, contextError, contextLoading, error, routeState, retryContext } = useRawItemView({
    itemId,
    contextSize,
  });

  if (routeState === 'loading') {
    return <RawItemRouteState mode="loading" />;
  }

  if (routeState === 'error') {
    return <RawItemRouteState mode="error" errorMessage={error ?? undefined} />;
  }

  if (routeState === 'not_found' || !item) {
    return <RawItemRouteState mode="not_found" />;
  }

  const previousItem = contextItems.older[contextItems.older.length - 1];
  const nextItem = contextItems.newer[0];
  const hasContext = contextItems.older.length > 0 || contextItems.newer.length > 0;
  const focusedFeedHref = buildRawFeedFocusHrefForItem(item, { contextSize: focusedFeedContextSize });
  const liveFeedHref = buildRawFeedSourceHrefForItem(item);

  function expandContext() {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set('context', String(MAX_RAW_ITEM_CONTEXT_SIZE));
    setSearchParams(nextSearchParams, { replace: true });
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <RawCitationSurface>
        <RawCitationPanelHeader
          title="Focused Citation"
          description={RAW_ITEM_CITATION_DESCRIPTION}
          aside={
            <RawCitationNavLinks
              links={[
                ...(focusedFeedHref ? [{ href: focusedFeedHref, label: 'Focused timeline' }] : []),
                ...(liveFeedHref ? [{ href: liveFeedHref, label: 'Live feed' }] : []),
              ]}
              metaLabel={item.sourceId}
              align="end"
            />
          }
        />

        <RawItemHeader
          source={item.source}
          timestampLabel={formatDateTime(item.timestamp)}
          previousHref={
            previousItem ? buildRawItemHref(previousItem.id, { contextSize: rawItemContextSize }) : undefined
          }
          nextHref={nextItem ? buildRawItemHref(nextItem.id, { contextSize: rawItemContextSize }) : undefined}
        />

        <RawMessageCard
          author={item.author}
          timestampLabel={formatDateTime(item.timestamp)}
          content={item.content}
          attachments={item.attachments}
          badges={[{ label: 'Focused item', tone: 'accent' }, { label: item.status }]}
          highlighted
          footerMeta={buildRawMessageFooterMeta(item)}
          actions={buildRawItemDetailActions(item, { feedContextSize: focusedFeedContextSize })}
        />
      </RawCitationSurface>

      {hasContext && <RawTimelineDivider label={RAW_ITEM_CONTEXT_DIVIDER_LABEL} />}

      <RawItemContextPanel
        older={contextItems.older}
        newer={contextItems.newer}
        contextSize={contextSize}
        feedContextSize={focusedFeedContextSize}
        itemContextSize={rawItemContextSize}
        contextError={contextError}
        contextLoading={contextLoading}
        canExpandContext={contextSize < MAX_RAW_ITEM_CONTEXT_SIZE}
        onExpandContext={expandContext}
        onRetryContext={retryContext}
        formatTimestamp={formatDateTime}
      />

      <RawItemMetadataGrid
        sourceId={item.sourceId}
        createdAtLabel={formatDateTime(item.createdAt)}
        translated={item.translated}
        originalLanguage={item.originalLanguage}
        filterReason={item.filterReason}
      />
    </div>
  );
}
