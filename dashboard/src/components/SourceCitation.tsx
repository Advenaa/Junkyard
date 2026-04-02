import { Link } from 'react-router';

interface SourceCitationProps {
  type: 'summary' | 'report' | 'item';
  id: string;
  label?: string;
}

export function SourceCitation({ type, id, label }: SourceCitationProps) {
  const displayLabel = label ?? `${type}:${id.slice(0, 6)}`;

  if (type === 'report') {
    return (
      <Link
        to={`/reports/${id}`}
        className="inline-block text-[11px] px-2 py-0.5 rounded-full bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
      >
        {displayLabel}
      </Link>
    );
  }

  return (
    <span
      title={`${type}: ${id}`}
      className="inline-block text-[11px] px-2 py-0.5 rounded-full bg-accent/20 text-accent cursor-default"
    >
      {displayLabel}
    </span>
  );
}
