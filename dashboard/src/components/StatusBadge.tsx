const COLORS: Record<string, string> = {
  delivered: 'bg-accent-green/20 text-accent-green',
  pending: 'bg-accent/20 text-accent',
  failed: 'bg-accent-red/20 text-accent-red',
};

export function StatusBadge({ status }: { status: string }) {
  const color = COLORS[status] ?? 'bg-border text-text-secondary';
  return <span className={`px-2 py-0.5 rounded text-xs font-mono ${color}`}>{status}</span>;
}
