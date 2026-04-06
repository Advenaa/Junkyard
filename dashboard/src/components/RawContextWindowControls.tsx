interface RawContextWindowControlsProps {
  contextSize: number;
  error?: string | null;
  loading?: boolean;
  canExpandContext?: boolean;
  onExpandContext?: () => void;
  onRetryContext?: () => void;
}

export function RawContextWindowControls({
  contextSize,
  error = null,
  loading = false,
  canExpandContext = false,
  onExpandContext,
  onRetryContext,
}: RawContextWindowControlsProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="font-mono text-[10px] text-text-secondary">Up to {contextSize} before and after</span>
      {loading ? (
        <span className="text-xs font-mono uppercase tracking-wider text-text-secondary">Loading more context...</span>
      ) : null}
      {error ? <span className="text-xs font-body text-accent-red">{error}</span> : null}
      {!loading && error && onRetryContext ? (
        <button
          type="button"
          onClick={onRetryContext}
          className="text-xs font-mono uppercase tracking-wider text-accent hover:underline"
        >
          Retry context
        </button>
      ) : null}
      {!loading && !error && canExpandContext && onExpandContext ? (
        <button
          type="button"
          onClick={onExpandContext}
          className="text-xs font-mono uppercase tracking-wider text-accent hover:underline"
        >
          Show more context
        </button>
      ) : null}
    </div>
  );
}
