export function normalizeRawMessageAttachments(raw: string | string[] | null): string[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return [];
}

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatAbsoluteDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function buildRawMessageFooterMeta(input: {
  attachments: string[];
  translated?: boolean;
  originalLanguage?: string | null;
  filterReason?: string | null;
}): string | undefined {
  const parts: string[] = [];

  if (input.attachments.length > 0) {
    parts.push(`${input.attachments.length} attachment${input.attachments.length !== 1 ? 's' : ''}`);
  }
  if (input.translated) {
    parts.push('Translated to English');
  }
  if (input.originalLanguage) {
    parts.push(`language ${input.originalLanguage}`);
  }
  if (input.filterReason) {
    parts.push(`filter ${input.filterReason}`);
  }

  return parts.length > 0 ? parts.join(' | ') : undefined;
}
