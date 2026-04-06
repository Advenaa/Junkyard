import { EmptyState } from './EmptyState';

interface RawItemRouteStateProps {
  mode: 'loading' | 'error' | 'not_found';
  errorMessage?: string;
}

export function RawItemRouteState({ mode, errorMessage }: RawItemRouteStateProps) {
  if (mode === 'loading') {
    return <div className="p-6 text-text-secondary font-body">Loading...</div>;
  }

  if (mode === 'error') {
    return <div className="p-6 text-accent-red font-body">Error: {errorMessage ?? 'Unknown error'}</div>;
  }

  return (
    <div className="p-6">
      <EmptyState title="Item not found" description="This raw source item is no longer available." />
    </div>
  );
}
