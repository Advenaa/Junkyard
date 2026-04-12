import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState';

export interface DataShellProps<T> {
  loading: boolean;
  error: string | null;
  data: T | null;
  retry?: () => void;
  retryCount?: number;
  maxRetries?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  isEmpty?: (data: T) => boolean;
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}

function DefaultSkeleton() {
  return (
    <div className="p-6 space-y-4">
      <div className="animate-pulse bg-surface rounded h-4 w-3/4" />
      <div className="animate-pulse bg-surface rounded h-4 w-full" />
      <div className="animate-pulse bg-surface rounded h-4 w-1/2" />
    </div>
  );
}

export function DataShell<T>({
  loading,
  error,
  data,
  retry,
  retryCount = 0,
  maxRetries = 3,
  emptyTitle = 'No data',
  emptyDescription,
  isEmpty,
  skeleton,
  children,
}: DataShellProps<T>) {
  if (loading) {
    return skeleton ?? <DefaultSkeleton />;
  }

  if (error !== null) {
    return (
      <div className="p-6">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <p className="text-accent-red">{error}</p>
          {retry && retryCount < maxRetries ? (
            <button type="button" className="mt-2 text-sm text-accent hover:underline" onClick={retry}>
              Retry
            </button>
          ) : null}
          {retry && retryCount >= maxRetries ? (
            <p className="mt-2 text-sm text-text-secondary">Retries exhausted. Refresh the page to try again.</p>
          ) : null}
        </div>
      </div>
    );
  }

  if (data === null || isEmpty?.(data)) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return <>{children(data)}</>;
}
