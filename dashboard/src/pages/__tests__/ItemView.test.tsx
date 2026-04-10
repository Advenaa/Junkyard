import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { Feed } from '../Feed';
import { ItemView } from '../ItemView';

describe('ItemView', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders raw item content, metadata, attachments, and expandable source context', async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const parsed = new URL(url, 'http://localhost');
        const path = decodeURIComponent(parsed.pathname);

        if (path === '/api/v1/items/item-1') {
          const contextSize = parsed.searchParams.get('context');
          expect(['3', '6']).toContain(contextSize);
          return new Response(
            JSON.stringify({
              item: {
                id: 'item-1',
                source: 'discord',
                sourceId: 'guild:1234',
                author: 'alice',
                content: 'Governance confirmed remediation in the original message.',
                timestamp: Date.UTC(2026, 3, 6, 8, 0, 0),
                url: 'https://example.com/source',
                engagement: 0,
                attachments: ['https://cdn.example.com/image.png'],
                originalLanguage: 'eng',
                translated: false,
                filterReason: null,
                status: 'processed',
                createdAt: Date.UTC(2026, 3, 6, 8, 1, 0),
              },
              context: {
                older: [
                  {
                    id: 'item-older',
                    source: 'discord',
                    sourceId: 'guild:1234',
                    author: 'bob',
                    content: 'Earlier reports said the first patch draft was almost ready.',
                    timestamp: Date.UTC(2026, 3, 6, 7, 56, 0),
                    url: 'https://example.com/context-earlier',
                    engagement: 0,
                    attachments: null,
                    originalLanguage: 'eng',
                    translated: false,
                    filterReason: null,
                    status: 'processed',
                    createdAt: Date.UTC(2026, 3, 6, 7, 56, 30),
                  },
                  ...(contextSize === '6'
                    ? [
                        {
                          id: 'item-oldest',
                          source: 'discord',
                          sourceId: 'guild:1234',
                          author: 'eve',
                          content: 'The first alert landed before the patch thread started.',
                          timestamp: Date.UTC(2026, 3, 6, 7, 50, 0),
                          url: null,
                          engagement: 0,
                          attachments: null,
                          originalLanguage: 'eng',
                          translated: false,
                          filterReason: null,
                          status: 'processed',
                          createdAt: Date.UTC(2026, 3, 6, 7, 50, 30),
                        },
                      ]
                    : []),
                ],
                newer: [
                  {
                    id: 'item-newer',
                    source: 'discord',
                    sourceId: 'guild:1234',
                    author: 'charlie',
                    content: 'A later follow-up said traders were waiting on the audit notes.',
                    timestamp: Date.UTC(2026, 3, 6, 8, 5, 0),
                    url: null,
                    engagement: 0,
                    attachments: ['https://cdn.example.com/second-image.png'],
                    originalLanguage: 'eng',
                    translated: false,
                    filterReason: null,
                    status: 'processed',
                    createdAt: Date.UTC(2026, 3, 6, 8, 5, 30),
                  },
                  ...(contextSize === '6'
                    ? [
                        {
                          id: 'item-latest',
                          source: 'discord',
                          sourceId: 'guild:1234',
                          author: 'diana',
                          content: 'Much later chatter moved on to exchange reopen timing.',
                          timestamp: Date.UTC(2026, 3, 6, 8, 9, 0),
                          url: null,
                          engagement: 0,
                          attachments: null,
                          originalLanguage: 'eng',
                          translated: false,
                          filterReason: null,
                          status: 'processed',
                          createdAt: Date.UTC(2026, 3, 6, 8, 9, 30),
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

        throw new Error(`Unhandled fetch ${path}`);
      }),
    );

    render(
      <MemoryRouter initialEntries={['/items/item-1']}>
        <Routes>
          <Route path="/items/:id" element={<ItemView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Governance confirmed remediation in the original message.');
    expect(screen.getByText('Focused Citation')).toBeInTheDocument();
    expect(screen.getByText(/This raw source message is opened directly/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Focused timeline' })).toHaveAttribute(
      'href',
      '/feed?source=discord&sourceId=guild%3A1234&itemId=item-1&context=3',
    );
    expect(screen.getByRole('link', { name: 'Live feed' })).toHaveAttribute(
      'href',
      '/feed?source=discord&sourceId=guild%3A1234',
    );
    expect(screen.getByText('Raw Item')).toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();
    expect(screen.getAllByText('guild:1234')).toHaveLength(2);
    expect(screen.getByText('Source Context')).toBeInTheDocument();
    expect(screen.getByText('Focused item')).toBeInTheDocument();
    expect(screen.getByText('Nearby source context continues below')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Previous in source' })).toHaveAttribute('href', '/items/item-older');
    expect(screen.getByRole('link', { name: 'Next in source' })).toHaveAttribute('href', '/items/item-newer');
    expect(screen.getByText('Earlier reports said the first patch draft was almost ready.')).toBeInTheDocument();
    expect(screen.getByText('A later follow-up said traders were waiting on the audit notes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show more context' })).toBeInTheDocument();
    expect(screen.getByText('Up to 3 before and after')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View in focused feed' })).toHaveAttribute(
      'href',
      '/feed?source=discord&sourceId=guild%3A1234&itemId=item-1&context=3',
    );
    expect(screen.getByRole('link', { name: 'Resume live feed' })).toHaveAttribute(
      'href',
      '/feed?source=discord&sourceId=guild%3A1234',
    );
    expect(screen.getByLabelText('View raw feed around item-older')).toHaveAttribute(
      'href',
      '/feed?source=discord&sourceId=guild%3A1234&itemId=item-older&context=3',
    );
    expect(screen.getByLabelText('View raw feed around item-newer')).toHaveAttribute(
      'href',
      '/feed?source=discord&sourceId=guild%3A1234&itemId=item-newer&context=3',
    );
    expect(screen.getByLabelText('Open raw item item-older')).toHaveAttribute('href', '/items/item-older');
    expect(screen.getByLabelText('Open raw item item-newer')).toHaveAttribute('href', '/items/item-newer');
    const sourceLinks = screen.getAllByRole('link', { name: 'Open source link' });
    expect(sourceLinks.some((link) => link.getAttribute('href') === 'https://example.com/source')).toBe(true);
    expect(sourceLinks.some((link) => link.getAttribute('href') === 'https://example.com/context-earlier')).toBe(true);
    expect(
      screen.getAllByRole('img').some((image) => image.getAttribute('src') === 'https://cdn.example.com/image.png'),
    ).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Show more context' }));

    await screen.findByText('The first alert landed before the patch thread started.');
    expect(screen.getByText('Much later chatter moved on to exchange reopen timing.')).toBeInTheDocument();
    expect(screen.getByText('Up to 6 before and after')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more context' })).not.toBeInTheDocument();
  });

  it('keeps the focused raw item visible when expanding source context fails and retries in place', async () => {
    const user = userEvent.setup();
    let expandedAttemptCount = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const parsed = new URL(url, 'http://localhost');
        const path = decodeURIComponent(parsed.pathname);

        if (path === '/api/v1/items/item-1') {
          const contextSize = parsed.searchParams.get('context');

          if (contextSize === '3') {
            return new Response(
              JSON.stringify({
                item: {
                  id: 'item-1',
                  source: 'discord',
                  sourceId: 'guild:1234',
                  author: 'alice',
                  content: 'Governance confirmed remediation in the original message.',
                  timestamp: Date.UTC(2026, 3, 6, 8, 0, 0),
                  url: 'https://example.com/source',
                  engagement: 0,
                  attachments: ['https://cdn.example.com/image.png'],
                  originalLanguage: 'eng',
                  translated: false,
                  filterReason: null,
                  status: 'processed',
                  createdAt: Date.UTC(2026, 3, 6, 8, 1, 0),
                },
                context: {
                  older: [
                    {
                      id: 'item-older',
                      source: 'discord',
                      sourceId: 'guild:1234',
                      author: 'bob',
                      content: 'Earlier reports said the first patch draft was almost ready.',
                      timestamp: Date.UTC(2026, 3, 6, 7, 56, 0),
                      url: null,
                      engagement: 0,
                      attachments: null,
                      originalLanguage: 'eng',
                      translated: false,
                      filterReason: null,
                      status: 'processed',
                      createdAt: Date.UTC(2026, 3, 6, 7, 56, 30),
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

          if (contextSize === '6') {
            expandedAttemptCount += 1;

            if (expandedAttemptCount === 1) {
              return new Response('boom', { status: 500, statusText: 'Internal Server Error' });
            }

            return new Response(
              JSON.stringify({
                item: {
                  id: 'item-1',
                  source: 'discord',
                  sourceId: 'guild:1234',
                  author: 'alice',
                  content: 'Governance confirmed remediation in the original message.',
                  timestamp: Date.UTC(2026, 3, 6, 8, 0, 0),
                  url: 'https://example.com/source',
                  engagement: 0,
                  attachments: ['https://cdn.example.com/image.png'],
                  originalLanguage: 'eng',
                  translated: false,
                  filterReason: null,
                  status: 'processed',
                  createdAt: Date.UTC(2026, 3, 6, 8, 1, 0),
                },
                context: {
                  older: [
                    {
                      id: 'item-oldest',
                      source: 'discord',
                      sourceId: 'guild:1234',
                      author: 'eve',
                      content: 'The first alert landed before the patch thread started.',
                      timestamp: Date.UTC(2026, 3, 6, 7, 50, 0),
                      url: null,
                      engagement: 0,
                      attachments: null,
                      originalLanguage: 'eng',
                      translated: false,
                      filterReason: null,
                      status: 'processed',
                      createdAt: Date.UTC(2026, 3, 6, 7, 50, 30),
                    },
                    {
                      id: 'item-older',
                      source: 'discord',
                      sourceId: 'guild:1234',
                      author: 'bob',
                      content: 'Earlier reports said the first patch draft was almost ready.',
                      timestamp: Date.UTC(2026, 3, 6, 7, 56, 0),
                      url: null,
                      engagement: 0,
                      attachments: null,
                      originalLanguage: 'eng',
                      translated: false,
                      filterReason: null,
                      status: 'processed',
                      createdAt: Date.UTC(2026, 3, 6, 7, 56, 30),
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

        throw new Error(`Unhandled fetch ${path}${parsed.search}`);
      }),
    );

    render(
      <MemoryRouter initialEntries={['/items/item-1']}>
        <Routes>
          <Route path="/items/:id" element={<ItemView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Governance confirmed remediation in the original message.');

    await user.click(screen.getByRole('button', { name: 'Show more context' }));

    await screen.findByText('Unable to load more source context. Please try again.');
    expect(screen.getByText('Governance confirmed remediation in the original message.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry context' }));

    await screen.findByText('The first alert landed before the patch thread started.');
    expect(screen.queryByText('Unable to load more source context. Please try again.')).not.toBeInTheDocument();
  });

  it('keeps the wider source-context window while moving to the previous raw item in the same route', async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const parsed = new URL(url, 'http://localhost');
        const path = decodeURIComponent(parsed.pathname);

        if (path === '/api/v1/items/item-1') {
          const contextSize = parsed.searchParams.get('context');
          expect(['3', '6']).toContain(contextSize);
          return new Response(
            JSON.stringify({
              item: {
                id: 'item-1',
                source: 'discord',
                sourceId: 'guild:1234',
                author: 'alice',
                content: 'Governance confirmed remediation in the original message.',
                timestamp: Date.UTC(2026, 3, 6, 8, 0, 0),
                url: 'https://example.com/source',
                engagement: 0,
                attachments: null,
                originalLanguage: 'eng',
                translated: false,
                filterReason: null,
                status: 'processed',
                createdAt: Date.UTC(2026, 3, 6, 8, 1, 0),
              },
              context: {
                older: [
                  ...(contextSize === '6'
                    ? [
                        {
                          id: 'item-oldest',
                          source: 'discord',
                          sourceId: 'guild:1234',
                          author: 'eve',
                          content: 'The first alert landed before the patch thread started.',
                          timestamp: Date.UTC(2026, 3, 6, 7, 50, 0),
                          url: null,
                          engagement: 0,
                          attachments: null,
                          originalLanguage: 'eng',
                          translated: false,
                          filterReason: null,
                          status: 'processed',
                          createdAt: Date.UTC(2026, 3, 6, 7, 50, 30),
                        },
                      ]
                    : []),
                  {
                    id: 'item-older',
                    source: 'discord',
                    sourceId: 'guild:1234',
                    author: 'bob',
                    content: 'Earlier reports said the first patch draft was almost ready.',
                    timestamp: Date.UTC(2026, 3, 6, 7, 56, 0),
                    url: null,
                    engagement: 0,
                    attachments: null,
                    originalLanguage: 'eng',
                    translated: false,
                    filterReason: null,
                    status: 'processed',
                    createdAt: Date.UTC(2026, 3, 6, 7, 56, 30),
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

        if (path === '/api/v1/items/item-older') {
          expect(parsed.searchParams.get('context')).toBe('6');
          return new Response(
            JSON.stringify({
              item: {
                id: 'item-older',
                source: 'discord',
                sourceId: 'guild:1234',
                author: 'bob',
                content: 'Earlier reports said the first patch draft was almost ready.',
                timestamp: Date.UTC(2026, 3, 6, 7, 56, 0),
                url: null,
                engagement: 0,
                attachments: null,
                originalLanguage: 'eng',
                translated: false,
                filterReason: null,
                status: 'processed',
                createdAt: Date.UTC(2026, 3, 6, 7, 56, 30),
              },
              context: {
                older: [
                  {
                    id: 'item-oldest',
                    source: 'discord',
                    sourceId: 'guild:1234',
                    author: 'eve',
                    content: 'The first alert landed before the patch thread started.',
                    timestamp: Date.UTC(2026, 3, 6, 7, 50, 0),
                    url: null,
                    engagement: 0,
                    attachments: null,
                    originalLanguage: 'eng',
                    translated: false,
                    filterReason: null,
                    status: 'processed',
                    createdAt: Date.UTC(2026, 3, 6, 7, 50, 30),
                  },
                ],
                newer: [
                  {
                    id: 'item-1',
                    source: 'discord',
                    sourceId: 'guild:1234',
                    author: 'alice',
                    content: 'Governance confirmed remediation in the original message.',
                    timestamp: Date.UTC(2026, 3, 6, 8, 0, 0),
                    url: null,
                    engagement: 0,
                    attachments: null,
                    originalLanguage: 'eng',
                    translated: false,
                    filterReason: null,
                    status: 'processed',
                    createdAt: Date.UTC(2026, 3, 6, 8, 1, 0),
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

        throw new Error(`Unhandled fetch ${path}${parsed.search}`);
      }),
    );

    render(
      <MemoryRouter initialEntries={['/items/item-1']}>
        <Routes>
          <Route path="/items/:id" element={<ItemView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Governance confirmed remediation in the original message.');

    await user.click(screen.getByRole('button', { name: 'Show more context' }));

    await screen.findByText('The first alert landed before the patch thread started.');
    expect(screen.getByText('Up to 6 before and after')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Previous in source' }));

    await screen.findByText('Earlier reports said the first patch draft was almost ready.');
    expect(screen.getByText('The first alert landed before the patch thread started.')).toBeInTheDocument();
    expect(screen.getByText('Up to 6 before and after')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more context' })).not.toBeInTheDocument();
  });

  it('keeps the widened context window when switching from the raw-item route back into the focused feed', async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const parsed = new URL(url, 'http://localhost');
        const path = decodeURIComponent(parsed.pathname);

        if (path === '/api/v1/sources') {
          return new Response(
            JSON.stringify({
              sources: [{ source: 'discord', sourceId: 'guild:1234', label: 'Guild 1234' }],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        if (path === '/api/v1/feed/guild:1234') {
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

        if (path === '/api/v1/items/item-1') {
          const contextSize = parsed.searchParams.get('context');
          expect(['3', '5', '6']).toContain(contextSize);

          return new Response(
            JSON.stringify({
              item: {
                id: 'item-1',
                source: 'discord',
                sourceId: 'guild:1234',
                author: 'alice',
                content: 'Governance confirmed remediation in the original message.',
                timestamp: Date.UTC(2026, 3, 6, 8, 0, 0),
                url: 'https://example.com/source',
                engagement: 0,
                attachments: null,
                originalLanguage: 'eng',
                translated: false,
                filterReason: null,
                status: 'processed',
                createdAt: Date.UTC(2026, 3, 6, 8, 1, 0),
              },
              context: {
                older: [
                  ...(contextSize === '6'
                    ? [
                        {
                          id: 'item-oldest',
                          source: 'discord',
                          sourceId: 'guild:1234',
                          author: 'eve',
                          content: 'The first alert landed before the patch thread started.',
                          timestamp: Date.UTC(2026, 3, 6, 7, 50, 0),
                          url: null,
                          engagement: 0,
                          attachments: null,
                          originalLanguage: 'eng',
                          translated: false,
                          filterReason: null,
                          status: 'processed',
                          createdAt: Date.UTC(2026, 3, 6, 7, 50, 30),
                        },
                      ]
                    : []),
                  {
                    id: 'item-older',
                    source: 'discord',
                    sourceId: 'guild:1234',
                    author: 'bob',
                    content: 'Earlier reports said the first patch draft was almost ready.',
                    timestamp: Date.UTC(2026, 3, 6, 7, 56, 0),
                    url: null,
                    engagement: 0,
                    attachments: null,
                    originalLanguage: 'eng',
                    translated: false,
                    filterReason: null,
                    status: 'processed',
                    createdAt: Date.UTC(2026, 3, 6, 7, 56, 30),
                  },
                ],
                newer: [
                  {
                    id: 'item-newer',
                    source: 'discord',
                    sourceId: 'guild:1234',
                    author: 'charlie',
                    content: 'A later follow-up said traders were waiting on the audit notes.',
                    timestamp: Date.UTC(2026, 3, 6, 8, 5, 0),
                    url: null,
                    engagement: 0,
                    attachments: null,
                    originalLanguage: 'eng',
                    translated: false,
                    filterReason: null,
                    status: 'processed',
                    createdAt: Date.UTC(2026, 3, 6, 8, 5, 30),
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

        throw new Error(`Unhandled fetch ${path}${parsed.search}`);
      }),
    );

    render(
      <MemoryRouter initialEntries={['/items/item-1']}>
        <Routes>
          <Route path="/feed" element={<Feed />} />
          <Route path="/items/:id" element={<ItemView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Governance confirmed remediation in the original message.');

    await user.click(screen.getByRole('button', { name: 'Show more context' }));

    await screen.findByText('The first alert landed before the patch thread started.');
    expect(screen.getByRole('link', { name: 'Focused timeline' })).toHaveAttribute(
      'href',
      '/feed?source=discord&sourceId=guild%3A1234&itemId=item-1&context=5',
    );

    await user.click(screen.getByRole('link', { name: 'Focused timeline' }));

    await screen.findByText('The most recent feed page is already discussing something else.');
    await screen.findByText('Up to 5 before and after');
    expect(screen.queryByRole('button', { name: 'Show more context' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open raw item' })).toHaveAttribute('href', '/items/item-1?context=5');
  });
});
