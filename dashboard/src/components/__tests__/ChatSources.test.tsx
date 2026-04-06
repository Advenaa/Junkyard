import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ChatSources } from '../ChatSources';

describe('ChatSources', () => {
  it('renders report, summary, and item citations as links when routes exist', () => {
    render(
      <MemoryRouter>
        <ChatSources
          sources={[
            {
              type: 'report',
              id: 'report-1',
              label: 'Daily 2026-04-06',
              snippet: 'Daily report snippet',
            },
            {
              type: 'summary',
              id: 'summary-1',
              label: 'Summary summary-1',
              snippet: 'Summary snippet',
            },
            {
              type: 'item',
              id: 'item-1',
              label: 'Item item-1',
              snippet: 'Raw item snippet',
            },
          ]}
        />
      </MemoryRouter>,
    );

    const reportLink = screen.getByRole('link', { name: 'Daily 2026-04-06' });
    const summaryLink = screen.getByRole('link', { name: 'Summary summary-1' });
    const itemLink = screen.getByRole('link', { name: 'Item item-1' });
    expect(reportLink).toHaveAttribute('href', '/reports/report-1');
    expect(summaryLink).toHaveAttribute('href', '/summaries/summary-1');
    expect(itemLink).toHaveAttribute('href', '/items/item-1');
  });
});
