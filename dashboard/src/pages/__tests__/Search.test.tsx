import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { Search } from '../Search';

describe('Search', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders report and summary hits with detail links from all-scope search', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(url, 'http://localhost');

      if (parsed.pathname === '/api/v1/search') {
        expect(parsed.searchParams.get('scope')).toBe('all');
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'summary-1',
                resultType: 'summary',
                source: 'discord',
                sourceId: 'guild:1234',
                body: 'Bridge watchers flagged new follow-up chatter right after the governance post.',
                createdAt: Date.now() - 1000,
              },
              {
                id: 'report-1',
                resultType: 'report',
                reportType: 'daily',
                date: '2026-04-06',
                body: 'Exploit remediation stayed in focus as traders watched for the next governance response.',
                createdAt: Date.now(),
                eventChains: ['Bridge exploit chain: governance response kept the story active into the close.'],
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
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/search']}>
        <Routes>
          <Route path="/search" element={<Search />} />
        </Routes>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Search summaries and reports...'), 'exploit');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText('Event Chain');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('report')).toBeInTheDocument();
    expect(screen.getByText('guild:1234')).toBeInTheDocument();
    expect(
      screen.getByText('Bridge exploit chain: governance response kept the story active into the close.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /governance response kept the story active into the close/i }),
    ).toHaveAttribute('href', '/reports/report-1');
    expect(screen.getByRole('link', { name: /follow-up chatter right after the governance post/i })).toHaveAttribute(
      'href',
      '/summaries/summary-1',
    );
  });
});
