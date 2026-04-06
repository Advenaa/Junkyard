import type { ReactNode } from 'react';

interface RawCitationPanelHeaderProps {
  title: string;
  description: string;
  aside?: ReactNode;
  className?: string;
}

export function RawCitationPanelHeader({
  title,
  description,
  aside,
  className,
}: RawCitationPanelHeaderProps) {
  return (
    <div className={className ?? 'flex items-start justify-between gap-4 flex-wrap'}>
      <div>
        <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary">{title}</h2>
        <p className="mt-2 text-sm text-text-secondary font-body leading-relaxed">{description}</p>
      </div>
      {aside}
    </div>
  );
}
