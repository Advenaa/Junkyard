import { buildRawItemContextActions } from '../lib/rawMessageActions';
import { buildRawMessageFooterMeta } from '../lib/rawMessages';
import type { RawSourceItem } from '../lib/rawSourceItems';
import { RawCitationPanelHeader } from './RawCitationPanelHeader';
import { RawContextWindowControls } from './RawContextWindowControls';
import { RawMessageContextSection } from './RawMessageContextSection';

interface RawItemContextPanelProps {
  older: RawSourceItem[];
  newer: RawSourceItem[];
  contextSize: number;
  feedContextSize?: number;
  itemContextSize?: number;
  contextError?: string | null;
  contextLoading?: boolean;
  canExpandContext?: boolean;
  onExpandContext?: () => void;
  onRetryContext?: () => void;
  formatTimestamp: (timestamp: number) => string;
}

export function RawItemContextPanel({
  older,
  newer,
  contextSize,
  feedContextSize,
  itemContextSize,
  contextError = null,
  contextLoading = false,
  canExpandContext = false,
  onExpandContext,
  onRetryContext,
  formatTimestamp,
}: RawItemContextPanelProps) {
  const hasContext = older.length > 0 || newer.length > 0;
  if (!hasContext) return null;

  return (
    <div>
      <RawCitationPanelHeader
        title="Source Context"
        description="Nearby raw items from the same source stream to help reconstruct the surrounding conversation."
        aside={
          <RawContextWindowControls
            contextSize={contextSize}
            error={contextError}
            loading={contextLoading}
            canExpandContext={canExpandContext}
            onExpandContext={onExpandContext}
            onRetryContext={onRetryContext}
          />
        }
        className="flex items-center justify-between gap-3 flex-wrap mb-4"
      />

      <div className="space-y-6">
        <RawMessageContextSection<RawSourceItem>
          title="Earlier"
          items={older}
          formatTimestamp={formatTimestamp}
          getBadges={(item) => [{ label: item.status }]}
          getFooterMeta={buildRawMessageFooterMeta}
          getActions={(item) => buildRawItemContextActions(item, { feedContextSize, itemContextSize })}
          getCountLabel={(count) => `${count} item(s)`}
        />
        <RawMessageContextSection<RawSourceItem>
          title="Later"
          items={newer}
          formatTimestamp={formatTimestamp}
          getBadges={(item) => [{ label: item.status }]}
          getFooterMeta={buildRawMessageFooterMeta}
          getActions={(item) => buildRawItemContextActions(item, { feedContextSize, itemContextSize })}
          getCountLabel={(count) => `${count} item(s)`}
        />
      </div>
    </div>
  );
}
