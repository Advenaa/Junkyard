import { memo } from 'react';

interface BadgeProps {
  label: string;
  colorClass?: string;
  uppercase?: boolean;
  className?: string;
}

export const Badge = memo(function Badge({
  label,
  colorClass = 'bg-border text-text-secondary',
  uppercase = false,
  className,
}: BadgeProps) {
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-mono ${uppercase ? 'uppercase' : ''} ${colorClass}${className ? ` ${className}` : ''}`}
    >
      {label}
    </span>
  );
});
