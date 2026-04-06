import type { RawFeedSource } from '../lib/useRawFeedStream';

interface RawFeedHeaderProps {
  sources: RawFeedSource[];
  selectedSource: string;
  onSelectSource: (sourceId: string) => void;
  live: boolean;
  onSetLive: (live: boolean) => void;
  error?: string | null;
  onRetry: () => void | Promise<void>;
}

export function RawFeedHeader({
  sources,
  selectedSource,
  onSelectSource,
  live,
  onSetLive,
  error = null,
  onRetry,
}: RawFeedHeaderProps) {
  return (
    <>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="font-heading text-2xl text-text-primary">Raw Feed</h1>
        <div className="flex items-center gap-4">
          <select
            value={selectedSource}
            onChange={(event) => onSelectSource(event.target.value)}
            className="bg-background border border-border rounded-lg px-3 py-2 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
          >
            {sources.map((source) => (
              <option key={source.sourceId} value={source.sourceId}>
                {source.label}
              </option>
            ))}
          </select>

          <div className="flex bg-surface border border-border rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => onSetLive(true)}
              className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors ${
                live ? 'bg-accent-green/20 text-accent-green' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Live
            </button>
            <button
              type="button"
              onClick={() => onSetLive(false)}
              className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors ${
                !live ? 'bg-surface-raised text-text-primary' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Paused
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          <p>{error}</p>
          <button type="button" onClick={() => void onRetry()} className="mt-2 text-sm underline">
            Retry
          </button>
        </div>
      )}
    </>
  );
}
