import { RawMessageCard, type RawMessageCardAction, type RawMessageCardBadge } from './RawMessageCard';

interface RawMessageContextItemBase {
  id: string;
  author: string;
  content: string;
  timestamp: number;
  attachments: string[];
}

interface RawMessageContextSectionProps<T extends RawMessageContextItemBase> {
  title: string;
  items: T[];
  formatTimestamp: (timestamp: number) => string;
  getActions: (item: T) => RawMessageCardAction[];
  getBadges?: (item: T) => RawMessageCardBadge[];
  getFooterMeta?: (item: T) => string | undefined;
  getCountLabel?: (count: number) => string;
  imageAltPrefix?: string;
}

export function RawMessageContextSection<T extends RawMessageContextItemBase>({
  title,
  items,
  formatTimestamp,
  getActions,
  getBadges,
  getFooterMeta,
  getCountLabel,
  imageAltPrefix,
}: RawMessageContextSectionProps<T>) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className={`flex items-center gap-3 flex-wrap ${getCountLabel ? 'justify-between' : ''}`}>
        <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">{title}</div>
        {getCountLabel && (
          <span className="font-mono text-[10px] text-text-secondary">{getCountLabel(items.length)}</span>
        )}
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <RawMessageCard
            key={item.id}
            author={item.author}
            timestampLabel={formatTimestamp(item.timestamp)}
            content={item.content}
            attachments={item.attachments}
            badges={getBadges?.(item) ?? []}
            footerMeta={getFooterMeta?.(item)}
            actions={getActions(item)}
            imageAltPrefix={imageAltPrefix}
          />
        ))}
      </div>
    </div>
  );
}
