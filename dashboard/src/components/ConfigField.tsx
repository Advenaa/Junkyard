export function ConfigField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-text-secondary text-xs font-mono uppercase">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-surface-raised border border-border rounded px-3 py-2 text-text-primary text-sm font-body focus:outline-none focus:border-accent transition-colors"
      />
    </label>
  );
}
