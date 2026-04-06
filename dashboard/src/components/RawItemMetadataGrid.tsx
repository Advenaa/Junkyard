interface RawItemMetadataGridProps {
  sourceId: string;
  createdAtLabel: string;
  translated: boolean;
  originalLanguage: string | null;
  filterReason: string | null;
}

export function RawItemMetadataGrid({
  sourceId,
  createdAtLabel,
  translated,
  originalLanguage,
  filterReason,
}: RawItemMetadataGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className="bg-surface border border-border rounded-lg p-4">
        <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-2">Source ID</div>
        <div className="text-sm text-text-primary font-body break-all">{sourceId}</div>
      </div>
      <div className="bg-surface border border-border rounded-lg p-4">
        <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-2">Captured</div>
        <div className="text-sm text-text-primary font-body">{createdAtLabel}</div>
      </div>
      <div className="bg-surface border border-border rounded-lg p-4">
        <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-2">Flags</div>
        <div className="text-sm text-text-primary font-body leading-relaxed">
          {translated ? 'Translated to English' : 'Original text kept'}
          {originalLanguage && ` | language ${originalLanguage}`}
          {filterReason && ` | filter ${filterReason}`}
        </div>
      </div>
    </div>
  );
}
