export function FilterPills({
  options,
  selected,
  onSelect,
}: {
  options: string[];
  selected: string;
  onSelect: (option: string) => void;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map((option) => (
        <button
          key={option}
          onClick={() => onSelect(option)}
          className={`px-3 py-1 rounded-full text-xs font-mono transition-colors ${
            option === selected
              ? 'bg-accent text-background'
              : 'bg-surface-raised text-text-secondary border border-border hover:text-text-primary'
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
