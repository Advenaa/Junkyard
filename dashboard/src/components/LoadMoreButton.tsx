export function LoadMoreButton({
  loading,
  onClick,
  hasMore,
}: {
  loading: boolean;
  onClick: () => void;
  hasMore: boolean;
}) {
  if (!hasMore) return null;

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full py-2 text-sm font-mono text-text-secondary hover:text-text-primary bg-surface-raised border border-border rounded-lg transition-colors disabled:opacity-50"
    >
      {loading ? 'Loading...' : 'Load more'}
    </button>
  );
}
