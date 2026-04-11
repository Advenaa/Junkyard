import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { SummaryView } from '../SummaryView';

function renderSummaryView(initialEntry: string) {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/summaries/:id" element={<SummaryView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SummaryView', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders summary text, entities, and extracted events', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const path = new URL(url, 'http://localhost').pathname;

        if (path === '/api/v1/summaries/summary-1') {
          return new Response(
            JSON.stringify({
              summary: {
                id: 'summary-1',
                source: 'discord',
                sourceId: '123456',
                windowStart: Date.UTC(2026, 3, 6, 8, 0, 0),
                windowEnd: Date.UTC(2026, 3, 6, 9, 0, 0),
                sentiment: 0.45,
                urgency: 'elevated',
                itemCount: 4,
                createdAt: Date.UTC(2026, 3, 6, 9, 5, 0),
                text: 'The exploit response stayed active as governance discussion picked up.',
                confidence: 8,
                keyEvents: ['Governance discussion accelerated around the exploit response.'],
                entities: [
                  {
                    name: 'Solana',
                    aliases: ['SOL'],
                    type: 'token',
                    mentionCount: 3,
                    sentiment: 0.6,
                  },
                ],
                events: [
                  {
                    entityName: 'Solana',
                    eventType: 'governance',
                    description: 'Governance discussion accelerated around the exploit response.',
                    eventTime: Date.UTC(2026, 3, 6, 8, 40, 0),
                    chain: {
                      rootId: 'event-root-1',
                      position: 2,
                      eventCount: 3,
                      firstEventTime: Date.UTC(2026, 3, 5, 14, 0, 0),
                      latestEventTime: Date.UTC(2026, 3, 7, 10, 30, 0),
                      eventTypes: ['exploit', 'audit', 'governance'],
                      previousSummary: {
                        summaryId: 'summary-older',
                        eventType: 'audit',
                        description: 'Audit prep started after the first exploit disclosure.',
                        eventTime: Date.UTC(2026, 3, 5, 18, 30, 0),
                      },
                      nextSummary: {
                        summaryId: 'summary-newer',
                        eventType: 'governance',
                        description: 'The next summary tracked governance follow-through on the response.',
                        eventTime: Date.UTC(2026, 3, 7, 10, 30, 0),
                      },
                    },
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

        throw new Error(`Unhandled fetch ${path}`);
      }),
    );

    renderSummaryView('/summaries/summary-1?chain=event-root-1');

    await screen.findByText('The exploit response stayed active as governance discussion picked up.');
    expect(screen.getByText('Key Events')).toBeInTheDocument();
    expect(screen.getByText('Entities')).toBeInTheDocument();
    expect(screen.getByText('Extracted Events')).toBeInTheDocument();
    expect(screen.getAllByText('Governance discussion accelerated around the exploit response.')).toHaveLength(2);
    expect(screen.getByText('Solana')).toBeInTheDocument();
    expect(screen.getByText(/Event 2 of 3 in linked chain/)).toBeInTheDocument();
    expect(screen.getByText(/exploit -> audit -> governance/)).toBeInTheDocument();
    expect(screen.getByText(/Highlighting 1 linked event in this summary chain/)).toBeInTheDocument();
    expect(screen.getByText('Audit prep started after the first exploit disclosure.')).toBeInTheDocument();
    expect(screen.getByText('The next summary tracked governance follow-through on the response.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Previous summary in chain' })).toHaveAttribute(
      'href',
      '/summaries/summary-older?chain=event-root-1',
    );
    expect(screen.getByRole('link', { name: 'Next summary in chain' })).toHaveAttribute(
      'href',
      '/summaries/summary-newer?chain=event-root-1',
    );
  });

  it('renders the empty state when the requested summary returns 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const path = new URL(url, 'http://localhost').pathname;

        if (path === '/api/v1/summaries/summary-404') {
          return new Response(JSON.stringify({ error: 'Not Found' }), {
            status: 404,
            statusText: 'Not Found',
            headers: { 'Content-Type': 'application/json' },
          });
        }

        throw new Error(`Unhandled fetch ${path}`);
      }),
    );

    renderSummaryView('/summaries/summary-404');

    await screen.findByText('Summary not found');
    expect(screen.getByText('This summary is no longer available.')).toBeInTheDocument();
    expect(screen.queryByText(/Error: API 404: Not Found/)).not.toBeInTheDocument();
  });

  it('renders the error block when the requested summary returns 500', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const path = new URL(url, 'http://localhost').pathname;

        if (path === '/api/v1/summaries/summary-500') {
          return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            statusText: 'Internal Server Error',
            headers: { 'Content-Type': 'application/json' },
          });
        }

        throw new Error(`Unhandled fetch ${path}`);
      }),
    );

    renderSummaryView('/summaries/summary-500');

    await screen.findByText('Error: API 500: Internal Server Error — Internal Server Error');
    expect(screen.queryByText('Summary not found')).not.toBeInTheDocument();
  });
});
