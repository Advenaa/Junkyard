import { memo } from 'react';
import type { CalendarEventSnapshotEntry } from '../types';
import { formatCalendarCategoryLabel, formatCalendarRecurrenceLabel, formatDateTime } from '../formatters';

interface CalendarSectionProps {
  calendarEvents: CalendarEventSnapshotEntry[] | null;
  calendarEntries: CalendarEventSnapshotEntry[];
}

export const CalendarSection = memo(function CalendarSection({
  calendarEvents,
  calendarEntries,
}: CalendarSectionProps) {
  if (calendarEntries.length === 0) {
    return null;
  }

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Catalyst Watch</h2>
          <p className="text-text-secondary/70 text-sm font-body mt-1">
            Next scheduled catalysts from the shared market calendar. Detailed curation remains in Settings &gt;
            Pipeline.
          </p>
        </div>
        <span className="px-2 py-1 rounded bg-accent/10 text-accent border border-accent/20 text-[11px] font-mono uppercase tracking-wide">
          {calendarEvents?.length ?? calendarEntries.length} scheduled
        </span>
      </div>

      <div className="p-4 grid gap-3 md:grid-cols-3">
        {calendarEntries.map((event) => (
          <div key={event.id} className="rounded-lg border border-border bg-background p-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-text-primary text-sm font-body leading-snug">{event.name}</h3>
                <p className="text-text-secondary/70 text-sm font-body leading-relaxed">
                  {formatDateTime(event.nextOccurrence)}
                </p>
              </div>
              <span className="px-2 py-0.5 rounded bg-surface border border-border text-[11px] font-mono uppercase tracking-wide text-text-secondary">
                {formatCalendarCategoryLabel(event.category)}
              </span>
            </div>

            {event.description && (
              <p className="text-text-secondary/80 text-sm font-body leading-relaxed">{event.description}</p>
            )}

            <div className="flex flex-wrap gap-2 text-xs font-mono">
              <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                {formatCalendarRecurrenceLabel(event.recurrenceRule)}
              </span>
              {event.entityName && (
                <span className="px-2 py-1 rounded bg-surface border border-border text-text-secondary">
                  {event.entityName}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
