import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RawFeedHeader } from '../RawFeedHeader';

describe('RawFeedHeader', () => {
  it('renders the selected source and toggles live state through the provided callbacks', async () => {
    const user = userEvent.setup();
    const onSelectSource = vi.fn();
    const onSetLive = vi.fn();
    const alpha = { source: 'discord', sourceId: 'guild:alpha', label: 'Alpha Room' };
    const beta = { source: 'discord', sourceId: 'guild:beta', label: 'Beta Room' };

    render(
      <RawFeedHeader
        sources={[alpha, beta]}
        selectedFeedSource={alpha}
        onSelectSource={onSelectSource}
        live
        onSetLive={onSetLive}
        onRetry={() => {}}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Raw Feed' })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('discord::guild:alpha');

    await user.selectOptions(screen.getByRole('combobox'), 'discord::guild:beta');
    expect(onSelectSource).toHaveBeenCalledWith(beta);

    await user.click(screen.getByRole('button', { name: 'Paused' }));
    await user.click(screen.getByRole('button', { name: 'Live' }));
    expect(onSetLive).toHaveBeenNthCalledWith(1, false);
    expect(onSetLive).toHaveBeenNthCalledWith(2, true);
  });

  it('lets the user disambiguate two sources that share the same sourceId across kinds', async () => {
    const user = userEvent.setup();
    const onSelectSource = vi.fn();
    const discordCollision = { source: 'discord', sourceId: 'collision', label: 'Discord Collision' };
    const twitterCollision = { source: 'twitter', sourceId: 'collision', label: 'Twitter Collision' };

    render(
      <RawFeedHeader
        sources={[discordCollision, twitterCollision]}
        selectedFeedSource={discordCollision}
        onSelectSource={onSelectSource}
        live
        onSetLive={() => {}}
        onRetry={() => {}}
      />,
    );

    expect(screen.getByRole('combobox')).toHaveValue('discord::collision');

    await user.selectOptions(screen.getByRole('combobox'), 'twitter::collision');
    expect(onSelectSource).toHaveBeenCalledWith(twitterCollision);
  });

  it('renders a retryable error banner when the feed load fails', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <RawFeedHeader
        sources={[{ source: 'discord', sourceId: 'guild:alpha', label: 'Alpha Room' }]}
        selectedFeedSource={{ source: 'discord', sourceId: 'guild:alpha', label: 'Alpha Room' }}
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
