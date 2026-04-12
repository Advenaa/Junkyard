import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SentimentIndicator } from '../SentimentIndicator';

describe('SentimentIndicator', () => {
  it('renders positive values with the green class', () => {
    render(<SentimentIndicator value={0.5} />);

    expect(screen.getByText('0.50')).toHaveClass('text-accent-green');
  });

  it('renders negative values with the red class', () => {
    render(<SentimentIndicator value={-0.3} />);

    expect(screen.getByText('-0.30')).toHaveClass('text-accent-red');
  });

  it('renders neutral values with the secondary text class', () => {
    render(<SentimentIndicator value={0.05} />);

    expect(screen.getByText('0.05')).toHaveClass('text-text-secondary');
  });

  it('shows a down arrow when the previous value is higher', () => {
    render(<SentimentIndicator value={0.1} previous={0.3} />);

    expect(screen.getByText('0.10 ↓')).toBeInTheDocument();
  });

  it('shows an up arrow when the previous value is lower', () => {
    render(<SentimentIndicator value={0.3} previous={0.1} />);

    expect(screen.getByText('0.30 ↑')).toBeInTheDocument();
  });

  it('renders no arrow when there is no previous value', () => {
    render(<SentimentIndicator value={0.2} />);

    expect(screen.getByText('0.20')).toBeInTheDocument();
  });

  it('treats exact threshold values as positive and negative', () => {
    const { rerender } = render(<SentimentIndicator value={0.1} />);

    expect(screen.getByText('0.10')).toHaveClass('text-accent-green');

    rerender(<SentimentIndicator value={-0.1} />);

    expect(screen.getByText('-0.10')).toHaveClass('text-accent-red');
  });
});
