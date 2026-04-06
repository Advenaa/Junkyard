import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RawItemHeader } from '../RawItemHeader';

describe('RawItemHeader', () => {
  it('renders the source badge, raw item label, and timestamp', () => {
    render(
      <MemoryRouter>
        <RawItemHeader source="discord" timestampLabel="2026-04-06 08:00 UTC" />
      </MemoryRouter>,
    );

    expect(screen.getByText('discord')).toBeInTheDocument();
    expect(screen.getByText('Raw Item')).toBeInTheDocument();
    expect(screen.getByText('2026-04-06 08:00 UTC')).toBeInTheDocument();
  });

  it('supports a custom header label for other citation surfaces', () => {
    render(
      <MemoryRouter>
        <RawItemHeader source="discord" label="Pinned Citation" timestampLabel="2026-04-06 08:00 UTC" />
      </MemoryRouter>,
    );

    expect(screen.getByText('Pinned Citation')).toBeInTheDocument();
  });

  it('renders previous and next source-navigation links when provided', () => {
    render(
      <MemoryRouter>
        <RawItemHeader
          source="discord"
          timestampLabel="2026-04-06 08:00 UTC"
          previousHref="/items/item-prev"
          nextHref="/items/item-next"
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Previous in source' })).toHaveAttribute('href', '/items/item-prev');
    expect(screen.getByRole('link', { name: 'Next in source' })).toHaveAttribute('href', '/items/item-next');
  });
});
