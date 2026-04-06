import { useSearchParams } from 'react-router';
import { FocusedRawFeedPanel } from '../components/FocusedRawFeedPanel';
import { RawFeedHeader } from '../components/RawFeedHeader';
import { RawFeedMessageList } from '../components/RawFeedMessageList';
import { RawFeedNoSources } from '../components/RawFeedNoSources';
import { readRawRouteContextSize, toRawRouteContextParam } from '../lib/rawFeedNavigation';
import { formatRelativeTime } from '../lib/rawMessages';
import {
  DEFAULT_FOCUSED_RAW_FEED_CONTEXT_SIZE,
  MAX_FOCUSED_RAW_FEED_CONTEXT_SIZE,
  useFocusedRawFeed,
} from '../lib/useFocusedRawFeed';
import { DEFAULT_RAW_ITEM_CONTEXT_SIZE, MAX_RAW_ITEM_CONTEXT_SIZE } from '../lib/useRawItemView';
import { normalizeFeedItem, useRawFeedStream } from '../lib/useRawFeedStream';

export { normalizeFeedItem };

export function formatTime(ts: number): string {
  return formatRelativeTime(ts);
}

export function Feed() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSourceId = searchParams.get('sourceId') ?? '';
  const focusedItemId = searchParams.get('itemId') ?? '';
  const focusedContextSize = readRawRouteContextSize(
    searchParams.get('context'),
    DEFAULT_FOCUSED_RAW_FEED_CONTEXT_SIZE,
    MAX_FOCUSED_RAW_FEED_CONTEXT_SIZE,
  );
  const focusedFeedContextSize = toRawRouteContextParam(
    focusedContextSize,
    DEFAULT_FOCUSED_RAW_FEED_CONTEXT_SIZE,
    MAX_FOCUSED_RAW_FEED_CONTEXT_SIZE,
  );
  const rawItemContextSize = toRawRouteContextParam(
    focusedContextSize,
    DEFAULT_RAW_ITEM_CONTEXT_SIZE,
    MAX_RAW_ITEM_CONTEXT_SIZE,
  );
  const {
    sources,
    sourcesLoaded,
    selectedSource,
    setSelectedSource,
    items,
    loading,
    error,
    loadingMore,
    hasMore,
    live,
    setLive,
    loadMore,
    reload,
  } = useRawFeedStream({ requestedSourceId });

  const {
    focusedContext,
    focusedContextError,
    focusedContextLoading,
    focusedGapLabel,
    focusedRawFeedActive,
    retryFocusedContext,
  } = useFocusedRawFeed({
    focusedItemId,
    requestedSourceId,
    selectedSource,
    items,
    loading,
    contextSize: focusedContextSize,
  });

  if (sourcesLoaded && sources.length === 0 && !error) {
    return <RawFeedNoSources />;
  }

  function expandFocusedContext() {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set('context', String(MAX_FOCUSED_RAW_FEED_CONTEXT_SIZE));
    setSearchParams(nextSearchParams, { replace: true });
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <RawFeedHeader
        sources={sources}
        selectedSource={selectedSource}
        onSelectSource={setSelectedSource}
        live={live}
        onSetLive={setLive}
        error={error}
        onRetry={reload}
      />

      {focusedRawFeedActive && (
        <FocusedRawFeedPanel
          focusedContext={focusedContext}
          focusedContextError={focusedContextError}
          focusedContextLoading={focusedContextLoading}
          focusedGapLabel={focusedGapLabel}
          contextSize={focusedContextSize}
          feedContextSize={focusedFeedContextSize}
          itemContextSize={rawItemContextSize}
          requestedSourceId={requestedSourceId}
          selectedSource={selectedSource}
          showTimelineGap={items.length > 0}
          canExpandContext={focusedContextSize < MAX_FOCUSED_RAW_FEED_CONTEXT_SIZE}
          onExpandContext={expandFocusedContext}
          onRetryContext={retryFocusedContext}
          formatTimestamp={formatTime}
        />
      )}

      <RawFeedMessageList
        items={items}
        loading={loading}
        focusedItemId={focusedItemId}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={loadMore}
        formatTimestamp={formatTime}
      />
    </div>
  );
}
