import { useState } from 'react';

export function SectionAccordion({
  title,
  body,
  defaultOpen = false,
}: {
  title: string;
  body: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface-raised text-text-primary text-sm font-heading hover:bg-border/30 transition-colors"
      >
        {title}
        <span className={`text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`}>&#9662;</span>
      </button>
      {open && (
        <div className="px-4 py-3 bg-surface text-text-secondary text-sm leading-relaxed whitespace-pre-wrap">
          {body}
        </div>
      )}
    </div>
  );
}
