interface Source {
  source: string;
  sourceId: string;
  label: string;
  enabled: boolean;
  stateStatus: string;
  lastFetchedAt: string | null;
  errorCount: number;
}

const STATUS_DOT: Record<string, string> = {
  active: 'bg-accent-green',
  error: 'bg-accent-red',
  idle: 'bg-text-secondary',
};

export function SourceRow({ source }: { source: Source }) {
  const dotColor = STATUS_DOT[source.stateStatus] ?? 'bg-text-secondary';

  return (
    <tr className="border-b border-border hover:bg-surface-raised/50 transition-colors">
      <td className="px-4 py-3 text-text-primary text-sm">{source.label}</td>
      <td className="px-4 py-3">
        <span className="text-text-secondary text-xs font-mono uppercase">{source.source}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${dotColor}`} />
          <span className="text-text-secondary text-xs">{source.stateStatus}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-text-secondary text-xs font-mono">
        {source.lastFetchedAt ?? 'never'}
      </td>
      <td className="px-4 py-3">
        {source.errorCount > 0 && (
          <span className="text-accent-red text-xs font-mono">{source.errorCount} errors</span>
        )}
      </td>
      <td className="px-4 py-3">
        <button
          className={`w-10 h-5 rounded-full transition-colors relative ${source.enabled ? 'bg-accent' : 'bg-border'}`}
          title={source.enabled ? 'Enabled' : 'Disabled'}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-text-primary transition-transform ${
              source.enabled ? 'left-5' : 'left-0.5'
            }`}
          />
        </button>
      </td>
    </tr>
  );
}
