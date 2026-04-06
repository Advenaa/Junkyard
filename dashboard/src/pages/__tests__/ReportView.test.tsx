import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ReportView } from '../ReportView';

describe('ReportView', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders market catalysts when the report includes them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const path = new URL(url, 'http://localhost').pathname;

        if (path === '/api/v1/reports/report-1') {
          return new Response(
            JSON.stringify({
              report: {
                id: 'report-1',
                date: '2026-04-06',
                type: 'daily',
                tldr: 'Macro risk is elevated ahead of a dense catalyst window.',
                sentiment: 0.4,
                deliveryStatus: 'delivered',
                createdAt: Date.now(),
                body: '{}',
                keyEvents: ['BTC broke higher on ETF flow chatter.'],
                marketCatalysts: [
                  'FOMC tomorrow is the main macro reset for crypto beta.',
                  'Friday BTC options expiry could sharpen short-term volatility.',
                ],
                eventChains: ['Bitcoin exploit chain: audit follow-up kept traders focused on remediation progress.'],
                entitySentiment: [{ name: 'Bitcoin', sentiment: 0.6, reason: 'ETF flows' }],
                sections: [{ title: 'Macro', body: 'Traders are watching catalysts closely.' }],
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
      <MemoryRouter initialEntries={['/reports/report-1']}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Market Catalysts');
    expect(screen.getByText('FOMC tomorrow is the main macro reset for crypto beta.')).toBeInTheDocument();
    expect(screen.getByText('Friday BTC options expiry could sharpen short-term volatility.')).toBeInTheDocument();
    expect(screen.getByText('Event Chains')).toBeInTheDocument();
    expect(
      screen.getByText('Bitcoin exploit chain: audit follow-up kept traders focused on remediation progress.'),
    ).toBeInTheDocument();
  });
});
