export function KeyEventCard({ event, index }: { event: string; index: number }) {
  return (
    <div className="bg-surface-raised border border-border rounded-lg p-4 flex gap-3 items-start">
      <span className="bg-accent/20 text-accent font-mono text-sm rounded-full w-7 h-7 flex items-center justify-center shrink-0">
        {index}
      </span>
      <p className="text-text-primary text-sm leading-relaxed">{event}</p>
    </div>
  );
}
