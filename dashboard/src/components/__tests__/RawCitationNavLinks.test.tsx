import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { RawCitationNavLinks } from '../RawCitationNavLinks';

describe('RawCitationNavLinks', () => {
  it('renders shared citation navigation links and optional meta text', () => {
    render(
      <MemoryRouter>
        <RawCitationNavLinks
          links={[
            { href: '/items/item-prev', label: 'Previous in source' },
            { href: '/items/item-next', label: 'Next in source' },
          ]}
          metaLabel="guild:alpha"
          align="end"
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Previous in source' })).toHaveAttribute('href', '/items/item-prev');
    expect(screen.getByRole('link', { name: 'Next in source' })).toHaveAttribute('href', '/items/item-next');
    expect(screen.getByText('guild:alpha')).toBeInTheDocument();
  });

  it('renders nothing when there are no links and no meta label', () => {
    const { container } = render(
      <MemoryRouter>
        <RawCitationNavLinks links={[]} />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
