import { memo, useCallback, useEffect, useRef, useState } from 'react';

interface CollapsibleSectionProps {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  storageKey?: string;
  children: React.ReactNode;
}

export const CollapsibleSection = memo(function CollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  storageKey,
  children,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(() => {
    if (storageKey && typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(`collapsible-${storageKey}`);
      if (stored != null) {
        return stored === 'true';
      }
    }

    return defaultOpen;
  });

  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (storageKey && typeof localStorage !== 'undefined') {
      localStorage.setItem(`collapsible-${storageKey}`, String(isOpen));
    }
  }, [isOpen, storageKey]);

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface hover:bg-surface-raised transition-colors"
        aria-expanded={isOpen}
      >
        <span className="font-heading text-text-primary text-sm">{title}</span>
        <span
          className="text-text-secondary text-xs transition-transform"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          ▼
        </span>
      </button>
      {!isOpen && summary ? (
        <div className="px-4 py-2 text-text-secondary text-xs border-t border-border">{summary}</div>
      ) : null}
      <div
        ref={contentRef}
        style={{
          maxHeight: isOpen ? '2000px' : '0',
          overflow: 'hidden',
          transition: 'max-height 0.3s ease-in-out',
        }}
      >
        <div className="px-4 py-3 border-t border-border">{children}</div>
      </div>
    </div>
  );
});
