import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataShell } from '../DataShell';

describe('DataShell', () => {
  it('renders skeleton when loading', () => {
    const { container } = render(
      <DataShell loading error={null} data={null}>
        {() => null}
      </DataShell>,
    );

    expect(container.querySelector('.p-6.space-y-4')).not.toBeNull();
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3);
  });

  it('renders custom skeleton when provided', () => {
    render(
      <DataShell loading error={null} data={null} skeleton={<div>Custom skeleton</div>}>
        {() => null}
      </DataShell>,
    );

    expect(screen.getByText('Custom skeleton')).toBeInTheDocument();
  });

  it('renders error with retry button', () => {
    const retry = vi.fn();

    render(
      <DataShell loading={false} error="Boom" data={null} retry={retry}>
        {() => null}
      </DataShell>,
    );

    expect(screen.getByText('Boom')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('renders retries exhausted when retryCount >= maxRetries', () => {
    render(
      <DataShell loading={false} error="Boom" data={null} retry={() => {}} retryCount={3}>
        {() => null}
      </DataShell>,
    );

    expect(screen.getByText('Retries exhausted. Refresh the page to try again.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('renders EmptyState when data is null', () => {
    render(
      <DataShell loading={false} error={null} data={null}>
        {() => null}
      </DataShell>,
    );

    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('renders EmptyState when isEmpty returns true', () => {
    render(
      <DataShell loading={false} error={null} data={[]} isEmpty={(data) => data.length === 0}>
        {() => null}
      </DataShell>,
    );

    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('renders children with data when loaded', () => {
    render(
      <DataShell loading={false} error={null} data={{ value: 'ready' }}>
        {(data) => <div>{data.value}</div>}
      </DataShell>,
    );

    expect(screen.getByText('ready')).toBeInTheDocument();
  });
});
