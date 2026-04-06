import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { FocusedRawFeedPanel } from '../FocusedRawFeedPanel';

describe('FocusedRawFeedPanel', () => {
  it('renders focused context, refocus actions, and the live-gap handoff', () => {
    render(
      <MemoryRouter>
        <FocusedRawFeedPanel
          focusedContext={{
            item: {
              id: 'item-focus',
              source: 'discord',
              sourceId: 'guild:beta',
              author: 'focus-user',
              content: 'Focused citation body',
              timestamp: 2_000,
              attachments: [],
              engagement: 0,
              url: 'https://example.com/focused-item',
              originalLanguage: 'eng',
              translated: false,
              filterReason: null,
              status: 'processed',
              createdAt: 2_001,
            },
            older: [
              {
                id: 'item-before',
                source: 'discord',
                sourceId: 'guild:beta',
                author: 'before-user',
                content: 'Earlier neighbor',
                timestamp: 1_500,
                attachments: [],
                engagement: 0,
                url: 'https://example.com/earlier-neighbor',
                originalLanguage: 'eng',
                translated: false,
                filterReason: null,
                status: 'processed',
                createdAt: 1_501,
              },
            ],
            newer: [
              {
                id: 'item-after',
                source: 'discord',
                sourceId: 'guild:beta',
                author: 'after-user',
                content: 'Later neighbor',
                timestamp: 2_500,
                attachments: [],
                engagement: 0,
                url: 'https://example.com/later-neighbor',
                originalLanguage: 'eng',
                translated: false,
                filterReason: null,
                status: 'processed',
                createdAt: 2_501,
              },
            ],
          }}
          focusedContextLoading={false}
          focusedGapLabel="Live feed resumes about 9 minutes later"
          contextSize={2}
          requestedSourceId="guild:beta"
          selectedSource="guild:beta"
          showTimelineGap
          formatTimestamp={(timestamp) => `${timestamp}ms`}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Focused Citation')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open raw item' })).toHaveAttribute('href', '/items/item-focus');
    expect(screen.getByRole('link', { name: 'Resume live feed' })).toHaveAttribute(
      'href',
      '/feed?sourceId=guild%3Abeta',
    );
    expect(screen.getByText('Earlier neighbor')).toBeInTheDocument();
    expect(screen.getByText('Focused citation body')).toBeInTheDocument();
    expect(screen.getByText('Later neighbor')).toBeInTheDocument();
    expect(screen.getByText('Live feed resumes about 9 minutes later')).toBeInTheDocument();
    expect(screen.getByText('Up to 2 before and after')).toBeInTheDocument();
    expect(screen.getAllByText('1 item(s)')).toHaveLength(2);
    expect(screen.getAllByText('processed')).toHaveLength(3);
    expect(screen.getByText('Captured')).toBeInTheDocument();
    expect(screen.getByText('Original text kept | language eng')).toBeInTheDocument();
    const sourceLinks = screen.getAllByRole('link', { name: 'Open source link' });
    expect(sourceLinks).toHaveLength(3);
    expect(sourceLinks.some((link) => link.getAttribute('href') === 'https://example.com/focused-item')).toBe(true);
    expect(sourceLinks.some((link) => link.getAttribute('href') === 'https://example.com/earlier-neighbor')).toBe(true);
    expect(sourceLinks.some((link) => link.getAttribute('href') === 'https://example.com/later-neighbor')).toBe(true);
    expect(screen.getByRole('link', { name: 'Previous in source' })).toHaveAttribute(
      'href',
      '/feed?sourceId=guild%3Abeta&itemId=item-before',
    );
    expect(screen.getByRole('link', { name: 'Next in source' })).toHaveAttribute(
      'href',
      '/feed?sourceId=guild%3Abeta&itemId=item-after',
    );

    const focusLinks = screen.getAllByRole('link', { name: 'Focus here' });
    expect(focusLinks[0]).toHaveAttribute('href', '/feed?sourceId=guild%3Abeta&itemId=item-before');
    expect(focusLinks[1]).toHaveAttribute('href', '/feed?sourceId=guild%3Abeta&itemId=item-after');

    const openLinks = screen.getAllByRole('link', { name: 'Open item' });
    expect(openLinks[0]).toHaveAttribute('href', '/items/item-before');
    expect(openLinks[1]).toHaveAttribute('href', '/items/item-focus');
    expect(openLinks[2]).toHaveAttribute('href', '/items/item-after');
  });

  it('supports expanding the focused context window', async () => {
    const user = userEvent.setup();
    const onExpandContext = vi.fn();

    render(
      <MemoryRouter>
        <FocusedRawFeedPanel
          focusedContext={{
            item: {
              id: 'item-focus',
              source: 'discord',
              sourceId: 'guild:beta',
              author: 'focus-user',
              content: 'Focused citation body',
              timestamp: 2_000,
              attachments: [],
              engagement: 0,
              url: null,
              originalLanguage: 'eng',
              translated: false,
              filterReason: null,
              status: 'processed',
              createdAt: 2_001,
            },
            older: [],
            newer: [],
          }}
          focusedContextLoading={false}
          focusedGapLabel="Live feed resumes below"
          contextSize={2}
          requestedSourceId="guild:beta"
          selectedSource="guild:beta"
          canExpandContext
          onExpandContext={onExpandContext}
          formatTimestamp={(timestamp) => `${timestamp}ms`}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Show more context' }));
    expect(onExpandContext).toHaveBeenCalledTimes(1);
  });

  it('shows retryable inline errors while keeping the focused citation visible', async () => {
    const user = userEvent.setup();
    const onRetryContext = vi.fn();

    render(
      <MemoryRouter>
        <FocusedRawFeedPanel
          focusedContext={{
            item: {
              id: 'item-focus',
              source: 'discord',
              sourceId: 'guild:beta',
              author: 'focus-user',
              content: 'Focused citation body',
              timestamp: 2_000,
              attachments: [],
              engagement: 0,
              url: null,
              originalLanguage: 'eng',
              translated: false,
              filterReason: null,
              status: 'processed',
              createdAt: 2_001,
            },
            older: [],
            newer: [],
          }}
          focusedContextError="Unable to load more context. Please try again."
          focusedContextLoading={false}
          focusedGapLabel="Live feed resumes below"
          contextSize={5}
          requestedSourceId="guild:beta"
          selectedSource="guild:beta"
          onRetryContext={onRetryContext}
          formatTimestamp={(timestamp) => `${timestamp}ms`}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Focused citation body')).toBeInTheDocument();
    expect(screen.getByText('Unable to load more context. Please try again.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more context' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry context' }));
    expect(onRetryContext).toHaveBeenCalledOnce();
  });

  it('shows a loading note while a larger focused-context window is being fetched', () => {
    render(
      <MemoryRouter>
        <FocusedRawFeedPanel
          focusedContext={{
            item: {
              id: 'item-focus',
              source: 'discord',
              sourceId: 'guild:beta',
              author: 'focus-user',
              content: 'Focused citation body',
              timestamp: 2_000,
              attachments: [],
              engagement: 0,
              url: null,
              originalLanguage: 'eng',
              translated: false,
              filterReason: null,
              status: 'processed',
              createdAt: 2_001,
            },
            older: [],
            newer: [],
          }}
          focusedContextLoading
          focusedGapLabel="Live feed resumes below"
          contextSize={5}
          requestedSourceId="guild:beta"
          selectedSource="guild:beta"
          formatTimestamp={(timestamp) => `${timestamp}ms`}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Focused citation body')).toBeInTheDocument();
    expect(screen.getByText('Loading more context...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more context' })).not.toBeInTheDocument();
  });

  it('renders the loading state without a resume link when source routing is unavailable', () => {
    render(
      <MemoryRouter>
        <FocusedRawFeedPanel
          focusedContext={null}
          focusedContextError={null}
          focusedContextLoading
          focusedGapLabel="Live feed resumes below"
          contextSize={2}
          requestedSourceId=""
          selectedSource="guild:beta"
          formatTimestamp={(timestamp) => `${timestamp}ms`}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Loading focused citation context...')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Resume live feed' })).not.toBeInTheDocument();
    expect(screen.queryByText('Live feed resumes below')).not.toBeInTheDocument();
  });

  it('renders a retryable error when the initial focused citation lookup fails', async () => {
    const user = userEvent.setup();
    const onRetryContext = vi.fn();

    render(
      <MemoryRouter>
        <FocusedRawFeedPanel
          focusedContext={null}
          focusedContextError="Unable to load focused citation context. Please try again."
          focusedContextLoading={false}
          focusedGapLabel="Live feed resumes below"
          contextSize={2}
          requestedSourceId="guild:beta"
          selectedSource="guild:beta"
          onRetryContext={onRetryContext}
          formatTimestamp={(timestamp) => `${timestamp}ms`}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Unable to load focused citation context. Please try again.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry context' }));
    expect(onRetryContext).toHaveBeenCalledOnce();
  });
});
