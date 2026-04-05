export function SentimentBar({ name, sentiment, reason }: { name: string; sentiment: number; reason?: string }) {
  const isPositive = sentiment >= 0;
  const width = Math.min(Math.abs(sentiment) * 100, 100);
  const barColor = isPositive ? 'bg-accent-green' : 'bg-accent-red';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-text-primary text-sm">{name}</span>
        <span className={`font-mono text-xs ${isPositive ? 'text-accent-green' : 'text-accent-red'}`}>
          {isPositive ? '+' : ''}
          {sentiment.toFixed(2)}
        </span>
      </div>
      <div className="h-2 bg-surface rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${width}%` }} />
      </div>
      {reason && <p className="text-text-secondary text-xs">{reason}</p>}
    </div>
  );
}
