import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { EntityLink } from '../EntityLink';

describe('EntityLink', () => {
  it('links to an entity detail route when entityId is provided', () => {
    render(
      <MemoryRouter>
        <EntityLink entityId="btc" name="Bitcoin" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Bitcoin' })).toHaveAttribute('href', '/entities/btc');
  });

  it('falls back to the entity search route when entityId is missing', () => {
    render(
      <MemoryRouter>
        <EntityLink name="Bitcoin Cash" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Bitcoin Cash' })).toHaveAttribute('href', '/entities?q=Bitcoin%20Cash');
  });

  it('supports the deprecated displayName prop for existing callers', () => {
    render(
      <MemoryRouter>
        <EntityLink entityId="eth" displayName="Ethereum" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Ethereum' })).toHaveAttribute('href', '/entities/eth');
  });
});
