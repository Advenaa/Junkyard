import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { Feed } from '../Feed';
import { ItemView } from '../ItemView';

describe('Feed', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('uses the sourceId query param and links feed cards to raw item drilldowns', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const parsed = new URL(url, 'http://localhost');

        if (parsed.pathname === '/api/v1/sources') {
          return new Response(
            JSON.stringify({
              sources: [
                { source: 'discord', sourceId: 'guild:alpha', label: 'Alpha Room' },
                { source: 'discord', sourceId: 'guild:beta', label: 'Beta Room' },
              ],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        if (parsed.pathname === '/api/v1/feed/guild:beta') {
          expect(parsed.searchParams.get('limit')).toBe('50');
          expect(parsed.searchParams.get('offset')).toBe('0');
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: 'item-2',
                  source: 'discord',
                  author: 'beta-user',
                  content: 'Governance follow-up landed in the beta room first.',
                  timestamp: Date.now() - 10_000,
                  attachments: null,
                  engagement: null,
                },
              ],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
      }),
    );

    render(
      <MemoryRouter initialEntries={['/feed?sourceId=guild%3Abeta&itemId=item-2']}>
        <Routes>
          <Route path="/feed" element={<Feed />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Governance follow-up landed in the beta room first.');
    expect(screen.getByRole('combobox')).toHaveValue('guild:beta');
    expect(screen.getByText('Focused item')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open item' })).toHaveAttribute('href', '/items/item-2');
  });

  it('pins focused citation context when the deep-linked item is older than the current feed page', async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const parsed = new URL(url, 'http://localhost');

        if (parsed.pathname === '/api/v1/sources') {
          return new Response(
            JSON.stringify({
              sources: [{ source: 'discord', sourceId: 'guild:beta', label: 'Beta Room' }],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        if (parsed.pathname === '/api/v1/feed/guild:beta') {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: 'item-latest',
                  source: 'discord',
                  author: 'latest-user',
                  content: 'The most recent feed page is already discussing something else.',
                  timestamp: Date.now() - 5_000,
                  attachments: null,
                  engagement: null,
                },
              ],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        if (parsed.pathname === '/api/v1/items/item-focus') {
          const contextSize = parsed.searchParams.get('context');
          expect(['2', '5']).toContain(contextSize);
          return new Response(
            JSON.stringify({
              item: {
                id: 'item-focus',
                source: 'discord',
                sourceId: 'guild:beta',
                author: 'focus-user',
                content: 'This is the older cited message the user wanted to revisit.',
                timestamp: Date.now() - 600_000,
                attachments: null,
                engagement: 0,
                status: 'processed',
                originalLanguage: 'eng',
                translated: false,
                filterReason: null,
                url: 'https://example.com/cited-message',
                createdAt: Date.now() - 599_000,
              },
              context: {
                older: [
                  {
                    id: contextSize === '5' ? 'item-earliest' : 'item-before',
                    source: 'discord',
                    sourceId: 'guild:beta',
                    author: contextSize === '5' ? 'earliest-user' : 'before-user',
                    content:
                      contextSize === '5'
                        ? 'An even earlier setup message now appears after expanding the context window.'
                        : 'A nearby earlier message set up the cited discussion.',
                    timestamp: Date.now() - (contextSize === '5' ? 720_000 : 660_000),
                    attachments: null,
                    engagement: 0,
                    status: 'processed',
                    originalLanguage: 'eng',
                    translated: false,
                    filterReason: null,
                    url: contextSize === '5' ? 'https://example.com/item-earliest' : 'https://example.com/item-before',
                    createdAt: Date.now() - (contextSize === '5' ? 719_000 : 659_000),
                  },
                  ...(contextSize === '5'
                    ? [
                        {
                          id: 'item-before',
                          source: 'discord',
                          sourceId: 'guild:beta',
                          author: 'before-user',
                          content: 'A nearby earlier message set up the cited discussion.',
                          timestamp: Date.now() - 660_000,
                          attachments: null,
                          engagement: 0,
                          status: 'processed',
                          originalLanguage: 'eng',
                          translated: false,
                          filterReason: null,
                          url: 'https://example.com/item-before',
                          createdAt: Date.now() - 659_000,
                        },
                      ]
                    : []),
                ],
                newer: [
                  {
                    id: 'item-after',
                    source: 'discord',
                    sourceId: 'guild:beta',
                    author: 'after-user',
                    content: 'A nearby later reply reacted to the cited message.',
                    timestamp: Date.now() - 540_000,
                    attachments: null,
                    engagement: 0,
                    status: 'processed',
                    originalLanguage: 'eng',
                    translated: false,
                    filterReason: null,
                    url: 'https://example.com/item-after',
                    createdAt: Date.now() - 539_000,
                  },
                  ...(contextSize === '5'
                    ? [
                        {
                          id: 'item-latest-context',
                          source: 'discord',
                          sourceId: 'guild:beta',
                          author: 'latest-context-user',
                          content: 'A much later follow-up is also visible after expanding the context window.',
                          timestamp: Date.now() - 480_000,
                          attachments: null,
                          engagement: 0,
                          status: 'processed',
                          originalLanguage: 'eng',
                          translated: false,
                          filterReason: null,
                          url: 'https://example.com/item-latest-context',
                          createdAt: Date.now() - 479_000,
                        },
                      ]
                    : []),
                ],
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        if (parsed.pathname === '/api/v1/items/item-before') {
          expect(parsed.searchParams.get('context')).toBe('5');
          return new Response(
            JSON.stringify({
              item: {
                id: 'item-before',
                source: 'discord',
                sourceId: 'guild:beta',
                author: 'before-user',
                content: 'A nearby earlier message set up the cited discussion.',
                timestamp: Date.now() - 660_000,
                attachments: null,
                engagement: 0,
                status: 'processed',
                originalLanguage: 'eng',
                translated: false,
                filterReason: null,
                url: null,
                createdAt: Date.now() - 659_000,
              },
              context: {
                older: [
                  {
                    id: 'item-earliest',
                    source: 'discord',
                    sourceId: 'guild:beta',
                    author: 'earliest-user',
                    content: 'An even earlier setup message now appears after expanding the context window.',
                    timestamp: Date.now() - 720_000,
                    attachments: null,
                    engagement: 0,
                    status: 'processed',
                    originalLanguage: 'eng',
                    translated: false,
                    filterReason: null,
                    url: null,
                    createdAt: Date.now() - 719_000,
                  },
                ],
                newer: [
                  {
                    id: 'item-focus',
                    source: 'discord',
                    sourceId: 'guild:beta',
                    author: 'focus-user',
                    content: 'This is the older cited message the user wanted to revisit.',
                    timestamp: Date.now() - 600_000,
                    attachments: null,
                    engagement: 0,
                    status: 'processed',
                    originalLanguage: 'eng',
                    translated: false,
                    filterReason: null,
                    url: null,
                    createdAt: Date.now() - 599_000,
                  },
                ],
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
      }),
    );

    render(
      <MemoryRouter initialEntries={['/feed?sourceId=guild%3Abeta&itemId=item-focus']}>
        <Routes>
          <Route path="/feed" element={<Feed />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('This is the older cited message the user wanted to revisit.');
    expect(screen.getByText('Focused Citation')).toBeInTheDocument();
    expect(screen.getByText('Live feed resumes about 9 minutes later')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open raw item' })).toHaveAttribute('href', '/items/item-focus');
    const sourceLinks = screen.getAllByRole('link', { name: 'Open source link' });
    expect(sourceLinks.some((link) => link.getAttribute('href') === 'https://example.com/cited-message')).toBe(true);
    expect(sourceLinks.some((link) => link.getAttribute('href') === 'https://example.com/item-before')).toBe(true);
    expect(sourceLinks.some((link) => link.getAttribute('href') === 'https://example.com/item-after')).toBe(true);
    expect(screen.getByRole('link', { name: 'Resume live feed' })).toHaveAttribute('href', '/feed?sourceId=guild%3Abeta');
    expect(screen.getByRole('link', { name: 'Previous in source' })).toHaveAttribute(
      'href',
      '/feed?sourceId=guild%3Abeta&itemId=item-before',
    );
    expect(screen.getByRole('link', { name: 'Next in source' })).toHaveAttribute(
      'href',
      '/feed?sourceId=guild%3Abeta&itemId=item-after',
    );
    expect(screen.getByRole('button', { name: 'Show more context' })).toBeInTheDocument();
    expect(screen.getByText('Up to 2 before and after')).toBeInTheDocument();
    expect(screen.getByText('Original text kept | language eng')).toBeInTheDocument();
    expect(screen.getByText('A nearby earlier message set up the cited discussion.')).toBeInTheDocument();
    expect(screen.getByText('A nearby later reply reacted to the cited message.')).toBeInTheDocument();
    expect(screen.getByText('The most recent feed page is already discussing something else.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show more context' }));

    await screen.findByText('An even earlier setup message now appears after expanding the context window.');
    expect(screen.getByText('A much later follow-up is also visible after expanding the context window.')).toBeInTheDocument();
    expect(screen.getByText('Up to 5 before and after')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more context' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Previous in source' }));

    await screen.findByText('A nearby earlier message set up the cited discussion.');
    expect(screen.getByText('This is the older cited message the user wanted to revisit.')).toBeInTheDocument();
    expect(screen.getByText('Focused Citation')).toBeInTheDocument();
    expect(screen.getByText('Up to 5 before and after')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more context' })).not.toBeInTheDocument();
    expect(screen.queryByText('A nearby later reply reacted to the cited message.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Resume live feed' }));

    await waitFor(() => {
      expect(screen.queryByText('Focused Citation')).not.toBeInTheDocument();
    });
    expect(screen.getByText('The most recent feed page is already discussing something else.')).toBeInTheDocument();
  });

  it('keeps the widened context window when switching from the focused feed into the raw-item route', async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const parsed = new URL(url, 'http://localhost');

        if (parsed.pathname === '/api/v1/sources') {
          return new Response(
            JSON.stringify({
              sources: [{ source: 'discord', sourceId: 'guild:beta', label: 'Beta Room' }],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        if (parsed.pathname === '/api/v1/feed/guild:beta') {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: 'item-latest',
                  source: 'discord',
                  author: 'latest-user',
                  content: 'The most recent feed page is already discussing something else.',
                  timestamp: Date.now() - 5_000,
                  attachments: null,
                  engagement: null,
                },
              ],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        if (parsed.pathname === '/api/v1/items/item-focus') {
          const contextSize = parsed.searchParams.get('context');
          expect(['2', '5']).toContain(contextSize);

          return new Response(
            JSON.stringify({
              item: {
                id: 'item-focus',
                source: 'discord',
                sourceId: 'guild:beta',
                author: 'focus-user',
                content: 'This is the older cited message the user wanted to revisit.',
                timestamp: Date.now() - 600_000,
                attachments: null,
                engagement: 0,
                status: 'processed',
                originalLanguage: 'eng',
                translated: false,
                filterReason: null,
                url: 'https://example.com/cited-message',
                createdAt: Date.now() - 599_000,
              },
              context: {
                older: [
                  ...(contextSize === '5'
                    ? [
                        {
                          id: 'item-earliest',
                          source: 'discord',
                          sourceId: 'guild:beta',
                          author: 'earliest-user',
                          content: 'An even earlier setup message now appears after expanding the context window.',
                          timestamp: Date.now() - 660_000,
                          attachments: null,
                          engagement: 0,
                          status: 'processed',
                          originalLanguage: 'eng',
                          translated: false,
                          filterReason: null,
                          url: null,
                          createdAt: Date.now() - 659_500,
                        },
                      ]
                    : []),
                  {
                    id: 'item-before',
                    source: 'discord',
                    sourceId: 'guild:beta',
                    author: 'before-user',
                    content: 'A nearby earlier message set up the cited discussion.',
                    timestamp: Date.now() - 630_000,
                    attachments: null,
                    engagement: 0,
                    status: 'processed',
                    originalLanguage: 'eng',
                    translated: false,
                    filterReason: null,
                    url: 'https://example.com/item-before',
                    createdAt: Date.now() - 629_500,
                  },
                ],
                newer: [
                  {
                    id: 'item-after',
                    source: 'discord',
                    sourceId: 'guild:beta',
                    author: 'after-user',
                    content: 'A nearby later reply reacted to the cited message.',
                    timestamp: Date.now() - 570_000,
                    attachments: null,
                    engagement: 0,
                    status: 'processed',
                    originalLanguage: 'eng',
                    translated: false,
                    filterReason: null,
                    url: 'https://example.com/item-after',
                    createdAt: Date.now() - 569_500,
                  },
                  ...(contextSize === '5'
                    ? [
                        {
                          id: 'item-latest-followup',
                          source: 'discord',
                          sourceId: 'guild:beta',
                          author: 'followup-user',
                          content: 'A much later follow-up is also visible after expanding the context window.',
                          timestamp: Date.now() - 540_000,
                          attachments: null,
                          engagement: 0,
                          status: 'processed',
                          originalLanguage: 'eng',
                          translated: false,
                          filterReason: null,
                          url: null,
                          createdAt: Date.now() - 539_500,
                        },
                      ]
                    : []),
                ],
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
      }),
    );

    render(
      <MemoryRouter initialEntries={['/feed?sourceId=guild%3Abeta&itemId=item-focus']}>
        <Routes>
          <Route path="/feed" element={<Feed />} />
          <Route path="/items/:id" element={<ItemView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('This is the older cited message the user wanted to revisit.');

    await user.click(screen.getByRole('button', { name: 'Show more context' }));

    await screen.findByText('An even earlier setup message now appears after expanding the context window.');
    expect(screen.getByRole('link', { name: 'Open raw item' })).toHaveAttribute('href', '/items/item-focus?context=5');

    await user.click(screen.getByRole('link', { name: 'Open raw item' }));

    await screen.findByText('Source Context');
    expect(screen.getByText('Up to 5 before and after')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Focused timeline' })).toHaveAttribute(
      'href',
      '/feed?sourceId=guild%3Abeta&itemId=item-focus&context=5',
    );
    expect(screen.getByRole('button', { name: 'Show more context' })).toBeInTheDocument();
  });

  it('keeps the pinned citation visible when expanding context fails and retries the wider fetch in place', async () => {
    const user = userEvent.setup();
    let expandedAttemptCount = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const parsed = new URL(url, 'http://localhost');

        if (parsed.pathname === '/api/v1/sources') {
          return new Response(
            JSON.stringify({
              sources: [{ source: 'discord', sourceId: 'guild:beta', label: 'Beta Room' }],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        if (parsed.pathname === '/api/v1/feed/guild:beta') {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: 'item-latest',
                  source: 'discord',
                  author: 'latest-user',
                  content: 'The most recent feed page is already discussing something else.',
                  timestamp: Date.now() - 5_000,
                  attachments: null,
                  engagement: null,
                },
              ],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        if (parsed.pathname === '/api/v1/items/item-focus') {
          const contextSize = parsed.searchParams.get('context');

          if (contextSize === '2') {
            return new Response(
              JSON.stringify({
                item: {
                  id: 'item-focus',
                  source: 'discord',
                  sourceId: 'guild:beta',
                  author: 'focus-user',
                  content: 'This is the older cited message the user wanted to revisit.',
                  timestamp: Date.now() - 600_000,
                  attachments: null,
                  engagement: 0,
                  status: 'processed',
                  originalLanguage: 'eng',
                  translated: false,
                  filterReason: null,
                  url: null,
                  createdAt: Date.now() - 599_000,
                },
                context: {
                  older: [],
                  newer: [],
                },
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          }

          if (contextSize === '5') {
            expandedAttemptCount += 1;

            if (expandedAttemptCount === 1) {
              return new Response('boom', { status: 500, statusText: 'Internal Server Error' });
            }

            return new Response(
              JSON.stringify({
                item: {
                  id: 'item-focus',
                  source: 'discord',
                  sourceId: 'guild:beta',
                  author: 'focus-user',
                  content: 'This is the older cited message the user wanted to revisit.',
                  timestamp: Date.now() - 600_000,
                  attachments: null,
                  engagement: 0,
                  status: 'processed',
                  originalLanguage: 'eng',
                  translated: false,
                  filterReason: null,
                  url: null,
                  createdAt: Date.now() - 599_000,
                },
                context: {
                  older: [
                    {
                      id: 'item-earliest',
                      source: 'discord',
                      sourceId: 'guild:beta',
                      author: 'earliest-user',
                      content: 'An even earlier setup message now appears after retrying the context expansion.',
                      timestamp: Date.now() - 720_000,
                      attachments: null,
                      engagement: 0,
                      status: 'processed',
                      originalLanguage: 'eng',
                      translated: false,
                      filterReason: null,
                      url: null,
                      createdAt: Date.now() - 719_000,
                    },
                  ],
                  newer: [],
                },
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          }
        }

        throw new Error(`Unhandled fetch ${parsed.pathname}${parsed.search}`);
      }),
    );

    render(
      <MemoryRouter initialEntries={['/feed?sourceId=guild%3Abeta&itemId=item-focus']}>
        <Routes>
          <Route path="/feed" element={<Feed />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('This is the older cited message the user wanted to revisit.');

    await user.click(screen.getByRole('button', { name: 'Show more context' }));

    await screen.findByText('Unable to load more context. Please try again.');
    expect(screen.getByText('This is the older cited message the user wanted to revisit.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more context' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry context' }));

    await screen.findByText('An even earlier setup message now appears after retrying the context expansion.');
    expect(screen.queryByText('Unable to load more context. Please try again.')).not.toBeInTheDocument();
  });
});
