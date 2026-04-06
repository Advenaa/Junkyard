import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RawFeedHeader } from '../RawFeedHeader';

describe('RawFeedHeader', () => {
  it('renders the selected source and toggles live state through the provided callbacks', async () => {
    const user = userEvent.setup();
    const onSelectSource = vi.fn();
    const onSetLive = vi.fn();

    render(
      <RawFeedHeader
        sources={[
          { source: 'discord', sourceId: 'guild:alpha', label: 'Alpha Room' },
          { source: 'discord', sourceId: 'guild:beta', label: 'Beta Room' },
        ]}
        selectedSource="guild:alpha"
        onSelectSource={onSelectSource}
        live
        onSetLive={onSetLive}
        onRetry={() => {}}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Raw Feed' })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('guild:alpha');

    await user.selectOptions(screen.getByRole('combobox'), 'guild:beta');
    expect(onSelectSource).toHaveBeenCalledWith('guild:beta');

    await user.click(screen.getByRole('button', { name: 'Paused' }));
    await user.click(screen.getByRole('button', { name: 'Live' }));
    expect(onSetLive).toHaveBeenNthCalledWith(1, false);
    expect(onSetLive).toHaveBeenNthCalledWith(2, true);
  });

  it('renders a retryable error banner when the feed load fails', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <RawFeedHeader
        sources={[{ source: 'discord', sourceId: 'guild:alpha', label: 'Alpha Room' }]}
        selectedSource="guild:alpha"
        onSelectSource={() => {}}
        live={false}
        onSetLive={() => {}}
        error="Failed to load feed. Please try again."
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('Failed to load feed. Please try again.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
