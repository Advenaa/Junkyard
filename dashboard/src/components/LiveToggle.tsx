export function LiveToggle({ live, onToggle }: { live: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono transition-colors ${
        live ? 'bg-accent-green/20 text-accent-green' : 'bg-border text-text-secondary'
      }`}
    >
      <span className={`w-2 h-2 rounded-full ${live ? 'bg-accent-green animate-pulse' : 'bg-text-secondary'}`} />
      {live ? 'LIVE' : 'PAUSED'}
    </button>
  );
}
