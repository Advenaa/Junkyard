import { Badge } from './Badge';

const COLORS: Record<string, string> = {
  daily: 'bg-accent/20 text-accent',
  flash: 'bg-accent-orange/20 text-accent-orange',
  pulse: 'bg-border text-text-secondary',
};

export function TypeBadge({ type }: { type: string }) {
  return <Badge label={type} colorClass={COLORS[type]} uppercase />;
}
