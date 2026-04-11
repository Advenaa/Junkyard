import { EmptyState } from './EmptyState';

export function RawFeedNoSources() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="font-heading text-2xl text-text-primary mb-6">Raw Feed</h1>
      <EmptyState
        title="No Discord or Twitter sources configured"
        description="Add a Discord channel or Twitter source in Settings to view raw messages here."
      />
    </div>
  );
}
