import { FeedImageGallery } from './FeedImageGallery';

interface FeedItemData {
  author: string;
  content: string;
  timestamp: string;
  attachments?: string[];
}

export function FeedItem({ item }: { item: FeedItemData }) {
  return (
    <div className="border-b border-border px-4 py-3 hover:bg-surface-raised/30 transition-colors">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-accent text-sm font-semibold">{item.author}</span>
        <span className="text-text-secondary text-xs font-mono">{item.timestamp}</span>
      </div>
      <p className="text-text-primary text-sm whitespace-pre-wrap leading-relaxed">{item.content}</p>
      {item.attachments && item.attachments.length > 0 && (
        <div className="mt-2">
          <FeedImageGallery urls={item.attachments} />
        </div>
      )}
    </div>
  );
}
