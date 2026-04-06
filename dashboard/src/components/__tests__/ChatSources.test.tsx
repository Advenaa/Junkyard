import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
              dateLabel: '2026-04-06',
              chainRootId: 'chain-root-1',
              chainLabel: 'Bridge · Governance',
            },
            {
              type: 'report',
              id: 'report-3',
              label: 'Daily 2026-04-08',
              snippet: 'Later report snippet',
              dateLabel: '2026-04-08',
              chainRootId: 'chain-root-1',
              chainLabel: 'Bridge · Governance',
            },
            {
              type: 'report',
              id: 'report-2',
              label: 'Daily 2026-04-07',
              snippet: 'Generic report snippet',
              dateLabel: '2026-04-07',
            },
            {
              type: 'summary',
              id: 'summary-1',
              label: 'Summary summary-1',
              snippet: 'Summary snippet',
              dateLabel: '2026-04-06',
              chainRootId: 'event-root-1',
              chainLabel: 'Solana · Governance',
            },
            {
              type: 'summary',
              id: 'summary-3',
              label: 'Summary summary-3',
              snippet: 'Related summary snippet',
              dateLabel: '2026-04-06',
              chainRootId: 'event-root-1',
              chainLabel: 'Solana · Governance',
            },
            {
              type: 'summary',
              id: 'summary-2',
              label: 'Summary summary-2',
              snippet: 'Generic summary snippet',
              dateLabel: '2026-04-05',
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

    const reportLink = screen.getByRole('link', { name: /Daily 2026-04-06/i });
    const genericReportLink = screen.getByRole('link', { name: /Daily 2026-04-07/i });
    const summaryLink = screen.getByRole('link', { name: /Summary summary-1/i });
    const genericSummaryLink = screen.getByRole('link', { name: /Summary summary-2/i });
    const itemLink = screen.getByRole('link', { name: /Item item-1/i });
    expect(reportLink).toHaveAttribute('href', '/reports/report-1?chain=chain-root-1');
    expect(genericReportLink).toHaveAttribute('href', '/reports/report-2');
    expect(summaryLink).toHaveAttribute('href', '/summaries/summary-1?chain=event-root-1');
    expect(genericSummaryLink).toHaveAttribute('href', '/summaries/summary-2');
    expect(itemLink).toHaveAttribute('href', '/items/item-1');
    expect(reportLink).toHaveAttribute('title', expect.stringContaining('Focused chain: Bridge · Governance'));
    expect(reportLink).toHaveAttribute('title', expect.stringContaining('Matches 2 report citations in this chain'));
    expect(reportLink).toHaveAttribute('title', expect.stringContaining('Daily 2026-04-08: Later report snippet'));
    expect(summaryLink).toHaveAttribute('title', expect.stringContaining('Focused chain: Solana · Governance'));
    expect(summaryLink).toHaveAttribute('title', expect.stringContaining('Matches 2 summary citations in this chain'));
    expect(summaryLink).toHaveAttribute('title', expect.stringContaining('Summary summary-3: Related summary snippet'));
    expect(reportLink).toHaveTextContent('Lead cite');
    expect(summaryLink).toHaveTextContent('Lead cite');
    expect(summaryLink).toHaveTextContent('2026-04-06');
    expect(screen.getAllByText('Focused chain')).toHaveLength(2);
    expect(screen.getAllByText('Lead cite')).toHaveLength(2);
    expect(screen.getAllByText('2 cites')).toHaveLength(2);
    expect(screen.queryByRole('link', { name: /Daily 2026-04-08/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Summary summary-3/i })).not.toBeInTheDocument();
  });

  it('reveals grouped focused-chain citations inline without losing the primary anchored pill', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ChatSources
          sources={[
            {
              type: 'report',
              id: 'report-1',
              label: 'Daily 2026-04-06',
              snippet: 'Daily report snippet',
              dateLabel: '2026-04-06',
              chainRootId: 'chain-root-1',
              chainLabel: 'Bridge · Governance',
            },
            {
              type: 'report',
              id: 'report-3',
              label: 'Daily 2026-04-08',
              snippet: 'Later report snippet',
              dateLabel: '2026-04-08',
              chainRootId: 'chain-root-1',
              chainLabel: 'Bridge · Governance',
            },
            {
              type: 'summary',
              id: 'summary-1',
              label: 'Summary summary-1',
              snippet: 'Summary snippet',
              dateLabel: '2026-04-06',
              chainRootId: 'event-root-1',
              chainLabel: 'Solana · Governance',
            },
            {
              type: 'summary',
              id: 'summary-3',
              label: 'Summary summary-3',
              snippet: 'Related summary snippet',
              dateLabel: '2026-04-06',
              chainRootId: 'event-root-1',
              chainLabel: 'Solana · Governance',
            },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Later report snippet')).not.toBeInTheDocument();
    expect(screen.queryByText('Related summary snippet')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show related citations for Daily 2026-04-06' }));
    await user.click(screen.getByRole('button', { name: 'Show related citations for Summary summary-1' }));

    expect(screen.getByRole('link', { name: /Daily 2026-04-06/i })).toHaveAttribute(
      'href',
      '/reports/report-1?chain=chain-root-1',
    );
    expect(screen.getByRole('link', { name: /Daily 2026-04-08/i })).toHaveAttribute(
      'href',
      '/reports/report-3?chain=chain-root-1',
    );
    expect(screen.getByRole('link', { name: /Summary summary-1/i })).toHaveAttribute(
      'href',
      '/summaries/summary-1?chain=event-root-1',
    );
    expect(screen.getByRole('link', { name: /Summary summary-3/i })).toHaveAttribute(
      'href',
      '/summaries/summary-3?chain=event-root-1',
    );
    expect(screen.getAllByText('Lead cite')).toHaveLength(2);
    expect(screen.getByText('Later report snippet')).toBeInTheDocument();
    expect(screen.getByText('Related summary snippet')).toBeInTheDocument();
    expect(screen.getByText('2026-04-08')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Summary summary-3/i })).toHaveTextContent('2026-04-06');
    expect(screen.getByText('Later')).toBeInTheDocument();
    expect(screen.getByText('Same day')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide related citations for Daily 2026-04-06' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide related citations for Summary summary-1' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide related citations for Daily 2026-04-06' }));
    await user.click(screen.getByRole('button', { name: 'Hide related citations for Summary summary-1' }));

    expect(screen.queryByRole('link', { name: /Daily 2026-04-08/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Summary summary-3/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Later report snippet')).not.toBeInTheDocument();
    expect(screen.queryByText('Related summary snippet')).not.toBeInTheDocument();
    expect(screen.queryByText('2026-04-08')).not.toBeInTheDocument();
    expect(screen.queryByText('Later')).not.toBeInTheDocument();
    expect(screen.queryByText('Same day')).not.toBeInTheDocument();
  });

  it('can promote a revealed same-chain citation into the grouped lead slot', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ChatSources
          sources={[
            {
              type: 'report',
              id: 'report-1',
              label: 'Daily 2026-04-06',
              snippet: 'Original lead snippet',
              dateLabel: '2026-04-06',
              chainRootId: 'chain-root-1',
              chainLabel: 'Bridge · Governance',
            },
            {
              type: 'report',
              id: 'report-3',
              label: 'Daily 2026-04-08',
              snippet: 'Later report snippet',
              dateLabel: '2026-04-08',
              chainRootId: 'chain-root-1',
              chainLabel: 'Bridge · Governance',
            },
            {
              type: 'report',
              id: 'report-4',
              label: 'Daily 2026-04-05',
              snippet: 'Earlier report snippet',
              dateLabel: '2026-04-05',
              chainRootId: 'chain-root-1',
              chainLabel: 'Bridge · Governance',
            },
          ]}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Show related citations for Daily 2026-04-06' }));

    expect(screen.getByRole('link', { name: /Daily 2026-04-06/i })).toHaveAttribute(
      'href',
      '/reports/report-1?chain=chain-root-1',
    );
    expect(screen.getByRole('link', { name: /Daily 2026-04-06/i })).toHaveTextContent('Lead cite');

    await user.click(screen.getByRole('button', { name: 'Make Daily 2026-04-08 the lead citation' }));

    const promotedLeadLink = screen.getByRole('link', { name: /Daily 2026-04-08/i });
    expect(promotedLeadLink).toHaveAttribute('href', '/reports/report-3?chain=chain-root-1');
    expect(promotedLeadLink).toHaveTextContent('Lead cite');
    expect(promotedLeadLink).toHaveTextContent('2026-04-08');
    expect(screen.getByRole('button', { name: 'Hide related citations for Daily 2026-04-08' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Daily 2026-04-06/i })).toHaveTextContent('Earlier');
    expect(screen.getByRole('link', { name: /Daily 2026-04-05/i })).toHaveTextContent('Earlier');
  });
});
