import { Link } from 'react-router';

interface EntityLinkProps {
  entityId?: string;
  name?: string;
  /** @deprecated Use `name` instead */
  displayName?: string;
}

export function EntityLink({ entityId, name, displayName }: EntityLinkProps) {
  const label = name || displayName || '';
  const to = entityId ? `/entities/${entityId}` : `/entities?q=${encodeURIComponent(label)}`;

  return (
    <Link to={to} className="text-accent hover:underline">
      {label}
    </Link>
  );
}
