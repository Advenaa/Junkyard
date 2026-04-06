import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { RawItemContextPanel } from '../RawItemContextPanel';

describe('RawItemContextPanel', () => {
  it('renders earlier and later source-context cards with feed and item actions', async () => {
    const user = userEvent.setup();
    const onExpandContext = vi.fn();

    render(
      <MemoryRouter>
        <RawItemContextPanel
          older={[
            {
              id: 'item-older',
              source: 'discord',
              sourceId: 'guild:1234',
              author: 'bob',
              content: 'Earlier reports said the first patch draft was almost ready.',
              timestamp: 1_000,
              url: 'https://example.com/item-older',
              engagement: 0,
              attachments: [],
              originalLanguage: 'eng',
              translated: false,
              filterReason: null,
              status: 'processed',
              createdAt: 1_001,
            },
          ]}
          newer={[
            {
              id: 'item-newer',
              source: 'discord',
              sourceId: 'guild:1234',
              author: 'charlie',
              content: 'A later follow-up said traders were waiting on the audit notes.',
              timestamp: 2_000,
              url: 'https://example.com/item-newer',
              engagement: 0,
              attachments: [],
              originalLanguage: 'eng',
              translated: false,
              filterReason: null,
              status: 'processed',
              createdAt: 2_001,
            },
          ]}
          contextSize={3}
          feedContextSize={3}
          canExpandContext
          onExpandContext={onExpandContext}
          formatTimestamp={(timestamp) => `${timestamp}ms`}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Source Context')).toBeInTheDocument();
    expect(screen.getByText('Up to 3 before and after')).toBeInTheDocument();
    expect(screen.getByText('Earlier reports said the first patch draft was almost ready.')).toBeInTheDocument();
    expect(screen.getByText('A later follow-up said traders were waiting on the audit notes.')).toBeInTheDocument();
    expect(screen.getByLabelText('View raw feed around item-older')).toHaveAttribute(
      'href',
      '/feed?sourceId=guild%3A1234&itemId=item-older&context=3',
    );
    const sourceLinks = screen.getAllByRole('link', { name: 'Open source link' });
    expect(sourceLinks[0]).toHaveAttribute('href', 'https://example.com/item-older');
    expect(sourceLinks[1]).toHaveAttribute('href', 'https://example.com/item-newer');
    expect(screen.getByLabelText('Open raw item item-newer')).toHaveAttribute('href', '/items/item-newer');
    await user.click(screen.getByRole('button', { name: 'Show more context' }));
    expect(onExpandContext).toHaveBeenCalledOnce();
  });

  it('shows a loading note while a larger source-context window is being fetched', () => {
    render(
      <MemoryRouter>
        <RawItemContextPanel
          older={[
            {
              id: 'item-older',
              source: 'discord',
              sourceId: 'guild:1234',
              author: 'bob',
              content: 'Earlier reports said the first patch draft was almost ready.',
              timestamp: 1_000,
              url: null,
              engagement: 0,
              attachments: [],
              originalLanguage: 'eng',
              translated: false,
              filterReason: null,
              status: 'processed',
              createdAt: 1_001,
            },
          ]}
          newer={[]}
          contextSize={6}
          contextLoading
          formatTimestamp={(timestamp) => `${timestamp}ms`}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Up to 6 before and after')).toBeInTheDocument();
    expect(screen.getByText('Loading more context...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more context' })).not.toBeInTheDocument();
  });

  it('shows retryable inline errors while keeping nearby source context visible', async () => {
    const user = userEvent.setup();
    const onRetryContext = vi.fn();

    render(
      <MemoryRouter>
        <RawItemContextPanel
          older={[
            {
              id: 'item-older',
              source: 'discord',
              sourceId: 'guild:1234',
              author: 'bob',
              content: 'Earlier reports said the first patch draft was almost ready.',
              timestamp: 1_000,
              url: null,
              engagement: 0,
              attachments: [],
              originalLanguage: 'eng',
              translated: false,
              filterReason: null,
              status: 'processed',
              createdAt: 1_001,
            },
          ]}
          newer={[]}
          contextSize={6}
          contextError="Unable to load more source context. Please try again."
          onRetryContext={onRetryContext}
          formatTimestamp={(timestamp) => `${timestamp}ms`}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Earlier reports said the first patch draft was almost ready.')).toBeInTheDocument();
    expect(screen.getByText('Unable to load more source context. Please try again.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more context' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry context' }));
    expect(onRetryContext).toHaveBeenCalledOnce();
  });

  it('renders nothing when there is no nearby source context', () => {
    const { container } = render(
      <MemoryRouter>
        <RawItemContextPanel older={[]} newer={[]} contextSize={3} formatTimestamp={(timestamp) => `${timestamp}ms`} />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
