import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingSkeleton } from '../LoadingSkeleton';

describe('LoadingSkeleton', () => {
  it('renders the default text variant', () => {
    render(<LoadingSkeleton />);

    expect(screen.getByRole('status', { name: 'Loading' })).toHaveClass('h-4', 'w-full', 'rounded');
  });

  it('renders the card variant', () => {
    render(<LoadingSkeleton variant="card" />);

    expect(screen.getByRole('status', { name: 'Loading' })).toHaveClass('h-24', 'w-full', 'rounded-lg');
  });

  it('renders the sparkline variant', () => {
    render(<LoadingSkeleton variant="sparkline" />);

    expect(screen.getByRole('status', { name: 'Loading' })).toHaveClass('h-6', 'w-24', 'rounded');
  });

  it('includes the animate-pulse class', () => {
    render(<LoadingSkeleton />);

    expect(screen.getByRole('status', { name: 'Loading' })).toHaveClass('animate-pulse');
  });

  it('applies a custom className', () => {
    render(<LoadingSkeleton className="mt-4" />);

    expect(screen.getByRole('status', { name: 'Loading' })).toHaveClass('mt-4');
  });
});
