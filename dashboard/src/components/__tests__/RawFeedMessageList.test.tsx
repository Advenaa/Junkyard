import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { RawFeedMessageList } from '../RawFeedMessageList';

describe('RawFeedMessageList', () => {
  it('renders the loading state before any feed items are available', () => {
    render(
      <MemoryRouter>
        <RawFeedMessageList
          items={[]}
          loading
          focusedItemId=""
          hasMore={false}
          loadingMore={false}
          onLoadMore={() => {}}
          formatTimestamp={(timestamp) => `${timestamp}ms`}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders an empty state when the feed has no items', () => {
    render(
      <MemoryRouter>
        <RawFeedMessageList
          items={[]}
          loading={false}
          focusedItemId=""
          hasMore={false}
          loadingMore={false}
          onLoadMore={() => {}}
          formatTimestamp={(timestamp) => `${timestamp}ms`}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('No messages yet')).toBeInTheDocument();
    expect(screen.getByText('Messages from this source will appear here once ingestion starts.')).toBeInTheDocument();
  });

  it('renders feed cards, highlights the focused item, and triggers load more', async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();

    render(
      <MemoryRouter>
        <RawFeedMessageList
          items={[
            {
              id: 'item-1',
              source: 'discord',
              author: 'alpha-user',
              content: 'First live item',
              timestamp: 1_000,
              attachments: [],
              engagement: null,
            },
            {
              id: 'item-2',
              source: 'discord',
              author: 'beta-user',
              content: 'Focused live item',
              timestamp: 2_000,
              attachments: [],
              engagement: null,
            },
          ]}
          loading={false}
          focusedItemId="item-2"
          hasMore
          loadingMore={false}
          onLoadMore={onLoadMore}
          formatTimestamp={(timestamp) => `${timestamp}ms`}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('First live item')).toBeInTheDocument();
    expect(screen.getByText('Focused live item')).toBeInTheDocument();
    expect(screen.getByText('Focused item')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Open item' })[1]).toHaveAttribute('href', '/items/item-2');

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
