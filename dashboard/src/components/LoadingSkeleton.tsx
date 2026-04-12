import { memo } from 'react';

interface LoadingSkeletonProps {
  variant?: 'text' | 'card' | 'sparkline';
  className?: string;
}

const variantClasses: Record<string, string> = {
  text: 'h-4 w-full rounded',
  card: 'h-24 w-full rounded-lg',
  sparkline: 'h-6 w-24 rounded',
};

export const LoadingSkeleton = memo(function LoadingSkeleton({ variant = 'text', className }: LoadingSkeletonProps) {
  return (
    <div
      className={`bg-surface-raised animate-pulse ${variantClasses[variant]}${className ? ` ${className}` : ''}`}
      role="status"
      aria-label="Loading"
    />
  );
});
