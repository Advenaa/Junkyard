import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sparkline } from '../Sparkline';

describe('Sparkline', () => {
  it('renders an empty svg for empty data', () => {
    const { container } = render(<Sparkline data={[]} />);

    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.querySelector('polyline')).not.toBeInTheDocument();
    expect(container.querySelector('path')).not.toBeInTheDocument();
    expect(container.querySelector('rect')).not.toBeInTheDocument();
  });

  it('renders a polyline for the line variant', () => {
    const { container } = render(
      <Sparkline
        data={[
          { x: 0, y: 2 },
          { x: 1, y: 4 },
          { x: 2, y: 3 },
        ]}
      />,
    );

    expect(screen.getByRole('img', { name: 'sparkline' })).toBeInTheDocument();
    expect(container.querySelector('polyline')).toBeInTheDocument();
  });

  it('renders rect elements for the bar variant', () => {
    const { container } = render(
      <Sparkline
        variant="bar"
        data={[
          { x: 0, y: 2 },
          { x: 1, y: 4 },
          { x: 2, y: 3 },
        ]}
      />,
    );

    expect(container.querySelectorAll('rect')).toHaveLength(3);
  });

  it('renders a path and polyline for the area variant', () => {
    const { container } = render(
      <Sparkline
        variant="area"
        data={[
          { x: 0, y: 2 },
          { x: 1, y: 4 },
          { x: 2, y: 3 },
        ]}
      />,
    );

    expect(container.querySelector('path')).toBeInTheDocument();
    expect(container.querySelector('polyline')).toBeInTheDocument();
  });

  it('handles a single data point without crashing', () => {
    const { container } = render(<Sparkline data={[{ x: 1, y: 2 }]} />);
    const polyline = container.querySelector('polyline');

    expect(polyline).toBeInTheDocument();
    expect(polyline).toHaveAttribute('points');
    expect(polyline?.getAttribute('points')).not.toContain('NaN');
  });

  it('handles all-zero y values without crashing', () => {
    const { container } = render(
      <Sparkline
        data={[
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ]}
      />,
    );
    const polyline = container.querySelector('polyline');

    expect(polyline).toBeInTheDocument();
    expect(polyline?.getAttribute('points')).not.toContain('NaN');
  });
});
