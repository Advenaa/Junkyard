import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RawItemRouteState } from '../RawItemRouteState';

describe('RawItemRouteState', () => {
  it('renders the loading state', () => {
    render(<RawItemRouteState mode="loading" />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders the error state with the provided message', () => {
    render(<RawItemRouteState mode="error" errorMessage="API 500: Internal Server Error" />);

    expect(screen.getByText('Error: API 500: Internal Server Error')).toBeInTheDocument();
  });

  it('renders the not-found empty state', () => {
    render(<RawItemRouteState mode="not_found" />);

    expect(screen.getByText('Item not found')).toBeInTheDocument();
    expect(screen.getByText('This raw source item is no longer available.')).toBeInTheDocument();
  });
});
