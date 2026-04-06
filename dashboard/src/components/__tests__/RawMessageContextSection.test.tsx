import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { RawMessageContextSection } from '../RawMessageContextSection';

describe('RawMessageContextSection', () => {
  it('renders a shared context section with optional count labels, badges, and actions', () => {
    render(
      <MemoryRouter>
        <RawMessageContextSection
          title="Earlier"
          items={[
            {
              id: 'item-1',
              author: 'alice',
              content: 'Earlier context item',
              timestamp: 1_000,
              attachments: [],
              status: 'processed',
            },
          ]}
          formatTimestamp={(timestamp) => `${timestamp}ms`}
          getBadges={(item) => [{ label: item.status }]}
          getFooterMeta={() => 'footer meta'}
          getActions={(item) => [{ href: `/items/${item.id}`, label: 'Open item', tone: 'accent' }]}
          getCountLabel={(count) => `${count} item(s)`}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Earlier')).toBeInTheDocument();
    expect(screen.getByText('1 item(s)')).toBeInTheDocument();
    expect(screen.getByText('Earlier context item')).toBeInTheDocument();
    expect(screen.getByText('processed')).toBeInTheDocument();
    expect(screen.getByText('footer meta')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open item' })).toHaveAttribute('href', '/items/item-1');
  });

  it('renders nothing when the section is empty', () => {
    const { container } = render(
      <MemoryRouter>
        <RawMessageContextSection
          title="Later"
          items={[]}
          formatTimestamp={(timestamp) => `${timestamp}ms`}
          getActions={() => []}
        />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
