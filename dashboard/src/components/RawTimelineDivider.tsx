interface RawTimelineDividerProps {
  label: string;
}

export function RawTimelineDivider({ label }: RawTimelineDividerProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-border" />
      <div className="text-[10px] font-mono uppercase tracking-wider text-text-secondary text-center">{label}</div>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
