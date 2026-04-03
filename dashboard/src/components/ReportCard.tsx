import type { Report } from '../lib/types';
import { TypeBadge } from './TypeBadge';
import { StatusBadge } from './StatusBadge';

export function ReportCard({ report }: { report: Report }) {
  const truncated = report.tldr.length > 120 ? report.tldr.slice(0, 120) + '...' : report.tldr;
  const { sentiment } = report;
  const sentimentColor = sentiment !== null
    ? sentiment >= 0.3 ? 'text-accent-green'
    : sentiment <= -0.3 ? 'text-accent-red'
    : 'text-text-secondary'
    : 'text-text-secondary';

  return (
    <div className="bg-surface-raised border border-border rounded-lg p-4 flex flex-col gap-2 hover:border-accent/40 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TypeBadge type={report.type} />
          <span className="text-text-secondary text-xs font-mono">{report.date}</span>
        </div>
        <StatusBadge status={report.deliveryStatus} />
      </div>
      <p className="text-text-primary text-sm leading-relaxed">{truncated}</p>
      <div className="flex items-center justify-between text-xs">
        <span className={`font-mono ${sentiment !== null ? sentimentColor : 'text-text-secondary'}`}>
          {sentiment !== null ? `${sentiment >= 0 ? '+' : ''}${sentiment.toFixed(2)}` : 'N/A'}
        </span>
        <span className="text-text-secondary font-mono">{report.createdAt}</span>
      </div>
    </div>
  );
}
