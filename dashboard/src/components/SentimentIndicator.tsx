import { memo } from 'react';

interface SentimentIndicatorProps {
  value: number;
  previous?: number;
}

function getColor(value: number): string {
  if (value >= 0.1) {
    return 'text-accent-green';
  }

  if (value <= -0.1) {
    return 'text-accent-red';
  }

  return 'text-text-secondary';
}

function getArrow(value: number, previous?: number): string {
  if (previous == null) {
    return '';
  }

  if (value > previous + 0.01) {
    return ' ↑';
  }

  if (value < previous - 0.01) {
    return ' ↓';
  }

  return ' →';
}

export const SentimentIndicator = memo(function SentimentIndicator({ value, previous }: SentimentIndicatorProps) {
  return (
    <span className={`font-mono text-sm ${getColor(value)}`}>
      {value.toFixed(2)}
      {getArrow(value, previous)}
    </span>
  );
});
