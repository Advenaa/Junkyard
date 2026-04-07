import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ReportView } from '../ReportView';

// ── Shared helpers ─────────────────────────────────────────────────────

function makeFullReport(overrides?: Record<string, unknown>) {
  return {
    id: 'report-price-1',
    date: '2026-04-07',
    type: 'daily',
    tldr: 'Crypto markets showing strength with BTC pushing past key levels.',
    sentiment: 0.5,
    deliveryStatus: 'delivered',
    createdAt: Date.now(),
    body: '{}',
    keyEvents: ['BTC broke $68K on strong spot demand.'],
    marketCatalysts: ['CPI data release tomorrow could set short-term direction.'],
    eventChains: [],
    chainDrilldowns: [],
    priceAlerts: [],
    entitySentiment: [{ name: 'Bitcoin', sentiment: 0.55, reason: 'Spot demand' }],
    sections: [{ title: 'Overview', body: 'Market structure remains bullish.' }],
    ...overrides,
  };
}

function buildReportFetchMock(report: ReturnType<typeof makeFullReport>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(url, 'http://localhost').pathname;

    if (path === `/api/v1/reports/${report.id}`) {
      return new Response(JSON.stringify({ report }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unhandled fetch ${path}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════

describe('ReportView price alerts', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows Price Alerts section when priceAlerts are present', async () => {
    const report = makeFullReport({
      priceAlerts: ['BTC surged +5.2% in 24h, crossing the $68K resistance level.'],
    });

    vi.stubGlobal('fetch', buildReportFetchMock(report));

    render(
      <MemoryRouter initialEntries={[`/reports/${report.id}`]}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Price Alerts');
    expect(
      screen.getByText('BTC surged +5.2% in 24h, crossing the $68K resistance level.'),
    ).toBeInTheDocument();
  });

  it('does not show Price Alerts section when priceAlerts array is empty', async () => {
    const report = makeFullReport({
      priceAlerts: [],
    });

    vi.stubGlobal('fetch', buildReportFetchMock(report));

    render(
      <MemoryRouter initialEntries={[`/reports/${report.id}`]}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    // Wait for the report to render (TL;DR is always present)
    await screen.findByText(report.tldr);

    // Price Alerts heading should NOT be in the document
    expect(screen.queryByText('Price Alerts')).not.toBeInTheDocument();
  });

  it('shows multiple price alerts when report contains several', async () => {
    const report = makeFullReport({
      priceAlerts: [
        'BTC surged +5.2% in 24h, crossing the $68K resistance level.',
        'ETH dropped -3.1% following whale sell-off on Binance.',
        'SOL hit all-time high at $245 with strong DEX volume.',
      ],
    });

    vi.stubGlobal('fetch', buildReportFetchMock(report));

    render(
      <MemoryRouter initialEntries={[`/reports/${report.id}`]}>
        <Routes>
          <Route path="/reports/:id" element={<ReportView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Price Alerts');
    expect(
      screen.getByText('BTC surged +5.2% in 24h, crossing the $68K resistance level.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('ETH dropped -3.1% following whale sell-off on Binance.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('SOL hit all-time high at $245 with strong DEX volume.'),
    ).toBeInTheDocument();
  });
});
