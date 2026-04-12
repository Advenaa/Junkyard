import { useState } from 'react';
import { apiFetch } from '../lib/api';

interface BookmarkButtonProps {
  reportId: string;
  bookmarked: boolean;
  onToggle: (reportId: string, bookmarked: boolean) => void;
  size?: 'sm' | 'md';
}

export function BookmarkButton({ reportId, bookmarked, onToggle, size = 'sm' }: BookmarkButtonProps) {
  const [saving, setSaving] = useState(false);

  const toggle = async () => {
    setSaving(true);
    try {
      if (bookmarked) {
        await apiFetch(`/bookmarks/${reportId}`, { method: 'DELETE' });
        onToggle(reportId, false);
      } else {
        await apiFetch('/bookmarks', {
          method: 'POST',
          body: JSON.stringify({ reportId }),
        });
        onToggle(reportId, true);
      }
    } catch {
      void 0;
    } finally {
      setSaving(false);
    }
  };

  const sizeClasses = size === 'md' ? 'w-8 h-8 text-base' : 'w-6 h-6 text-sm';

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggle();
      }}
      disabled={saving}
      aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark this report'}
      className={`${sizeClasses} flex items-center justify-center rounded transition-colors ${
        bookmarked ? 'text-accent hover:text-accent/80' : 'text-text-secondary/40 hover:text-text-secondary'
      } disabled:opacity-50`}
      title={bookmarked ? 'Remove bookmark' : 'Bookmark this report'}
    >
      {bookmarked ? '\u2605' : '\u2606'}
    </button>
  );
}
