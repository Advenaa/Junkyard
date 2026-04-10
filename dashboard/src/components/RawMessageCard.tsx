import { Link } from 'react-router';
import { unescapeMarkdownPunctuation } from '../lib/rawMessages';
import { isSafeUrl } from '../lib/url';

export interface RawMessageCardBadge {
  label: string;
  tone?: 'accent' | 'muted';
}

export interface RawMessageCardAction {
  href: string;
  label: string;
  tone?: 'accent' | 'muted';
  ariaLabel?: string;
  external?: boolean;
}

interface RawMessageCardProps {
  author: string;
  timestampLabel: string;
  content: string;
  attachments: string[];
  badges?: RawMessageCardBadge[];
  highlighted?: boolean;
  footerMeta?: string;
  actions?: RawMessageCardAction[];
  imageAltPrefix?: string;
}

function badgeClass(tone: 'accent' | 'muted' = 'muted'): string {
  return tone === 'accent'
    ? 'rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-accent'
    : 'rounded-full bg-surface px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-text-secondary';
}

function actionClass(tone: 'accent' | 'muted' = 'muted'): string {
  return tone === 'accent'
    ? 'text-xs font-mono uppercase tracking-wider text-accent hover:underline'
    : 'text-xs font-mono uppercase tracking-wider text-text-secondary hover:text-text-primary hover:underline';
}

export function RawMessageCard({
  author,
  timestampLabel,
  content,
  attachments,
  badges = [],
  highlighted = false,
  footerMeta,
  actions = [],
  imageAltPrefix = 'Attachment',
}: RawMessageCardProps) {
  return (
    <div
      className={`rounded-lg border p-4 space-y-2 ${
        highlighted
          ? 'bg-surface-raised border-accent shadow-[0_0_0_1px_rgba(77,171,247,0.18)]'
          : 'bg-surface border-border'
      }`}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-text-primary text-sm font-body font-medium">@{author}</span>
          {badges.map((badge) => (
            <span key={`${badge.tone ?? 'muted'}:${badge.label}`} className={badgeClass(badge.tone)}>
              {badge.label}
            </span>
          ))}
        </div>
        <span className="text-text-secondary text-xs font-mono">{timestampLabel}</span>
      </div>

      <p className="text-text-primary text-sm font-body leading-relaxed whitespace-pre-wrap">
        {unescapeMarkdownPunctuation(content)}
      </p>

      {attachments.length > 0 && (
        <div className="flex gap-2 flex-wrap pt-1">
          {attachments
            .slice(0, 4)
            .filter(isSafeUrl)
            .map((url, index) => (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block">
                <img
                  src={url}
                  alt={`${imageAltPrefix} ${index + 1}`}
                  loading="lazy"
                  className="max-w-[200px] max-h-[150px] rounded border border-border object-cover"
                />
              </a>
            ))}
        </div>
      )}

      {(footerMeta || actions.length > 0) && (
        <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
          <div className="text-xs text-text-secondary font-body leading-relaxed">{footerMeta ?? ''}</div>
          <div className="flex items-center gap-3 flex-wrap">
            {actions.map((action) =>
              action.external ? (
                <a
                  key={`${action.href}:${action.label}`}
                  href={action.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={action.ariaLabel}
                  className={actionClass(action.tone)}
                >
                  {action.label}
                </a>
              ) : (
                <Link
                  key={`${action.href}:${action.label}`}
                  to={action.href}
                  aria-label={action.ariaLabel}
                  className={actionClass(action.tone)}
                >
                  {action.label}
                </Link>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
