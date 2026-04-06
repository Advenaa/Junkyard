import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ItemView } from '../ItemView';

describe('ItemView', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders raw item content, metadata, and attachments', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const path = new URL(url, 'http://localhost').pathname;

        if (path === '/api/v1/items/item-1') {
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
    expect(screen.getByText('Raw Item')).toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();
    expect(screen.getByText('guild:1234')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://example.com/source' })).toHaveAttribute(
      'href',
      'https://example.com/source',
    );
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://cdn.example.com/image.png');
  });
});
