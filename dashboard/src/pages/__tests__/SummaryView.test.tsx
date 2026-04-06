import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { SummaryView } from '../SummaryView';

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

    render(
      <MemoryRouter initialEntries={['/summaries/summary-1']}>
        <Routes>
          <Route path="/summaries/:id" element={<SummaryView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('The exploit response stayed active as governance discussion picked up.');
    expect(screen.getByText('Key Events')).toBeInTheDocument();
    expect(screen.getByText('Entities')).toBeInTheDocument();
    expect(screen.getByText('Extracted Events')).toBeInTheDocument();
    expect(screen.getAllByText('Governance discussion accelerated around the exploit response.')).toHaveLength(2);
    expect(screen.getByText('Solana')).toBeInTheDocument();
  });
});
