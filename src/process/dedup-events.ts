import { distance } from 'fastest-levenshtein';

export function deduplicateEvents(events: string[], threshold = 0.85): string[] {
  const accepted: string[] = [];

  for (const event of events) {
    const isDuplicate = accepted.some((kept) => {
      const maxLen = Math.max(event.length, kept.length);
      if (maxLen === 0) return true;
      const similarity = 1 - distance(event, kept) / maxLen;
      return similarity >= threshold;
    });

    if (!isDuplicate) {
      accepted.push(event);
    }
  }

  return accepted;
}
