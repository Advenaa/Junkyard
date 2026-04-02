import { TypeBadge } from './TypeBadge';
import { StatusBadge } from './StatusBadge';

interface Report {
  id: string;
  date: string;
  type: string;
  tldr: string;
  sentiment: number;
  deliveryStatus: string;
  createdAt: string;
}

export function ReportCard({ report }: { report: Report }) {
  const truncated = report.tldr.length > 120 ? report.tldr.slice(0, 120) + '...' : report.tldr;
  const sentimentColor = report.sentiment >= 0 ? 'text-accent-green' : 'text-accent-red';

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
        <span className={`font-mono ${sentimentColor}`}>
          {report.sentiment >= 0 ? '+' : ''}{report.sentiment.toFixed(2)}
        </span>
        <span className="text-text-secondary font-mono">{report.createdAt}</span>
      </div>
    </div>
  );
}
