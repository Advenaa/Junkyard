import { Link } from 'react-router';

interface EntityLinkProps {
  entityId: string;
  displayName: string;
}

export function EntityLink({ entityId, displayName }: EntityLinkProps) {
  return (
    <Link to={`/entities/${entityId}`} className="text-accent hover:underline">
      {displayName}
    </Link>
  );
}
