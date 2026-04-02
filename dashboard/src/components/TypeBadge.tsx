const COLORS: Record<string, string> = {
  daily: 'bg-accent/20 text-accent',
  flash: 'bg-accent-orange/20 text-accent-orange',
  pulse: 'bg-border text-text-secondary',
};

export function TypeBadge({ type }: { type: string }) {
  const color = COLORS[type] ?? 'bg-border text-text-secondary';
  return <span className={`px-2 py-0.5 rounded text-xs font-mono uppercase ${color}`}>{type}</span>;
}
