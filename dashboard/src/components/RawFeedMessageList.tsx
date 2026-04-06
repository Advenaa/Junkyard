import { EmptyState } from './EmptyState';
import { RawMessageCard } from './RawMessageCard';
import { buildRawFeedMessageActions } from '../lib/rawMessageActions';
import { buildRawMessageFooterMeta } from '../lib/rawMessages';
import type { RawFeedItem } from '../lib/useRawFeedStream';

interface RawFeedMessageListProps {
  items: RawFeedItem[];
  loading: boolean;
  focusedItemId: string;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void | Promise<void>;
  formatTimestamp: (timestamp: number) => string;
}

export function RawFeedMessageList({
  items,
  loading,
  focusedItemId,
  hasMore,
  loadingMore,
  onLoadMore,
  formatTimestamp,
}: RawFeedMessageListProps) {
  if (loading) {
    return <div className="text-text-secondary font-body py-8">Loading...</div>;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="No messages yet"
        description="Messages from this source will appear here once ingestion starts."
      />
    );
  }

  return (
    <>
      <div className="space-y-3">
        {items.map((item) => (
          <RawMessageCard
            key={item.id}
            author={item.author}
            timestampLabel={formatTimestamp(item.timestamp)}
            content={item.content}
            attachments={item.attachments}
            badges={item.id === focusedItemId ? [{ label: 'Focused item', tone: 'accent' }] : []}
            highlighted={item.id === focusedItemId}
            footerMeta={buildRawMessageFooterMeta({ attachments: item.attachments })}
            actions={buildRawFeedMessageActions(item.id)}
            imageAltPrefix="Feed attachment"
          />
        ))}
      </div>

      {hasMore && (
        <div className="text-center pt-2">
          <button
            onClick={() => void onLoadMore()}
            disabled={loadingMore}
            className="px-6 py-2 bg-surface border border-border rounded-lg text-text-secondary text-sm font-body hover:text-text-primary hover:border-[#3a3a4f] transition-colors disabled:opacity-50"
          >
            {loadingMore ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}
    </>
  );
}
