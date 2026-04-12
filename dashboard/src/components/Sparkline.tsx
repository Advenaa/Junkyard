import { memo } from 'react';

interface SparklineProps {
  data: { x: number; y: number }[];
  variant?: 'line' | 'area' | 'bar';
  width?: number;
  height?: number;
  color?: string;
}

export const Sparkline = memo(function Sparkline({
  data,
  variant = 'line',
  width = 100,
  height = 24,
  color,
}: SparklineProps) {
  if (data.length === 0) {
    return <svg width={width} height={height} />;
  }

  const ys = data.map((d) => d.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeY = maxY - minY || 1;

  const xs = data.map((d) => d.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const rangeX = maxX - minX || 1;

  const pad = 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const scaleX = (x: number) => pad + ((x - minX) / rangeX) * innerW;
  const scaleY = (y: number) => pad + innerH - ((y - minY) / rangeY) * innerH;

  const resolvedColor = color ?? (ys[ys.length - 1] >= ys[0] ? 'var(--color-accent-green)' : 'var(--color-accent-red)');

  if (variant === 'bar') {
    const barWidth = Math.max(1, innerW / data.length - 1);

    return (
      <svg width={width} height={height} role="img" aria-label="sparkline">
        {data.map((d, i) => {
          const barH = ((d.y - minY) / rangeY) * innerH || 1;

          return (
            <rect
              key={i}
              x={pad + (i / data.length) * innerW}
              y={pad + innerH - barH}
              width={barWidth}
              height={barH}
              fill={resolvedColor}
              opacity={0.8}
            />
          );
        })}
      </svg>
    );
  }

  const points = data.map((d) => `${scaleX(d.x)},${scaleY(d.y)}`).join(' ');

  if (variant === 'area') {
    const pathD =
      `M${scaleX(data[0].x)},${scaleY(data[0].y)} ` +
      data
        .slice(1)
        .map((d) => `L${scaleX(d.x)},${scaleY(d.y)}`)
        .join(' ') +
      ` L${scaleX(data[data.length - 1].x)},${pad + innerH} L${scaleX(data[0].x)},${pad + innerH} Z`;

    return (
      <svg width={width} height={height} role="img" aria-label="sparkline">
        <path d={pathD} fill={resolvedColor} opacity={0.3} />
        <polyline points={points} fill="none" stroke={resolvedColor} strokeWidth={1.5} />
      </svg>
    );
  }

  return (
    <svg width={width} height={height} role="img" aria-label="sparkline">
      <polyline points={points} fill="none" stroke={resolvedColor} strokeWidth={1.5} />
    </svg>
  );
});
