import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RawFeedNoSources } from '../RawFeedNoSources';

describe('RawFeedNoSources', () => {
  it('renders the raw feed title and no-sources empty state copy', () => {
    render(<RawFeedNoSources />);

    expect(screen.getByRole('heading', { name: 'Raw Feed' })).toBeInTheDocument();
    expect(screen.getByText('No Discord or Twitter sources configured')).toBeInTheDocument();
    expect(
      screen.getByText('Add a Discord channel or Twitter source in Settings to view raw messages here.'),
    ).toBeInTheDocument();
  });
});
