import { RawCitationNavLinks } from './RawCitationNavLinks';

const SOURCE_COLORS: Record<string, string> = {
  discord: 'bg-accent/20 text-accent',
  twitter: 'bg-accent-orange/20 text-accent-orange',
  rss: 'bg-accent-green/20 text-accent-green',
  news: 'bg-border text-text-secondary',
};

function SourceBadge({ source }: { source: string }) {
  const color = SOURCE_COLORS[source] ?? 'bg-border text-text-secondary';
  return <span className={`px-2 py-0.5 rounded text-xs font-mono uppercase ${color}`}>{source}</span>;
}

interface RawItemHeaderProps {
  source: string;
  timestampLabel: string;
  previousHref?: string;
  nextHref?: string;
  label?: string;
}

export function RawItemHeader({
  source,
  timestampLabel,
  previousHref,
  nextHref,
  label = 'Raw Item',
}: RawItemHeaderProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <SourceBadge source={source} />
          <span className="font-mono text-xs text-text-secondary uppercase tracking-wider">{label}</span>
        </div>
        <span className="font-mono text-xs text-text-secondary">{timestampLabel}</span>
      </div>

      <RawCitationNavLinks
        links={[
          ...(previousHref ? [{ href: previousHref, label: 'Previous in source' }] : []),
          ...(nextHref ? [{ href: nextHref, label: 'Next in source' }] : []),
        ]}
      />
    </div>
  );
}
