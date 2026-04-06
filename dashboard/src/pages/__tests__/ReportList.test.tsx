import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ReportList } from '../ReportList';

describe('ReportList', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders event chain previews when the reports list includes them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const path = new URL(url, 'http://localhost');

        if (path.pathname === '/api/v1/reports') {
          return new Response(
            JSON.stringify({
              reports: [
                {
                  id: 'report-1',
                  date: '2026-04-06',
                  type: 'daily',
                  tldr: 'Bitcoin held gains while traders watched follow-up risk around a live exploit story.',
                  sentiment: 0.35,
                  deliveryStatus: 'delivered',
                  createdAt: Date.now(),
                  eventChains: ['Bitcoin exploit chain: audit follow-up kept the remediation story active.'],
                },
              ],
              total: 1,
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        throw new Error(`Unhandled fetch ${path.pathname}${path.search}`);
      }),
    );

    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route path="/reports" element={<ReportList />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Reports');
    expect(screen.getByText('Event Chain')).toBeInTheDocument();
    expect(
      screen.getByText('Bitcoin exploit chain: audit follow-up kept the remediation story active.'),
    ).toBeInTheDocument();
  });
});
