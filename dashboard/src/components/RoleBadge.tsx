const COLORS: Record<string, string> = {
  admin: 'bg-accent/20 text-accent',
  viewer: 'bg-border text-text-secondary',
  blocked: 'bg-accent-red/20 text-accent-red',
};

export function RoleBadge({ role }: { role: string }) {
  const color = COLORS[role] ?? 'bg-border text-text-secondary';
  return <span className={`px-2 py-0.5 rounded text-xs font-mono ${color}`}>{role}</span>;
}
