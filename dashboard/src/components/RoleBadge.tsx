import { Badge } from './Badge';

const COLORS: Record<string, string> = {
  admin: 'bg-accent/20 text-accent',
  viewer: 'bg-border text-text-secondary',
  blocked: 'bg-accent-red/20 text-accent-red',
};

export function RoleBadge({ role }: { role: string }) {
  return <Badge label={role} colorClass={COLORS[role]} />;
}
