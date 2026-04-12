import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';

const CATEGORIES = [
  { value: 'wrong_entity', label: 'Wrong entity' },
  { value: 'wrong_sentiment', label: 'Wrong sentiment' },
  { value: 'wrong_event_type', label: 'Wrong event type' },
  { value: 'spam', label: 'Spam / noise' },
  { value: 'other', label: 'Other issue' },
] as const;

interface FlagButtonProps {
  targetType: 'summary' | 'entity_mention';
  targetId: string;
}

export function FlagButton({ targetType, targetId }: FlagButtonProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  async function submit(category: (typeof CATEGORIES)[number]['value']): Promise<void> {
    setSaving(true);
    try {
      await apiFetch('/feedback', {
        method: 'POST',
        body: JSON.stringify({ targetType, targetId, category }),
      });
      setDone(true);
      hideTimerRef.current = window.setTimeout(() => {
        setOpen(false);
        setDone(false);
        hideTimerRef.current = null;
      }, 1500);
    } catch {
      return;
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return <span className="text-xs font-mono text-accent-green">Flagged</span>;
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        className="text-xs font-mono text-text-secondary/40 transition-colors hover:text-text-secondary"
        title="Flag this item"
      >
        Flag
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-border bg-surface py-1 shadow-lg">
          {CATEGORIES.map((category) => (
            <button
              key={category.value}
              type="button"
              onClick={() => void submit(category.value)}
              disabled={saving}
              className="block w-full px-3 py-1.5 text-left text-xs font-body text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary disabled:opacity-50"
            >
              {category.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
