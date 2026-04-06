import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RawCitationPanelHeader } from '../RawCitationPanelHeader';

describe('RawCitationPanelHeader', () => {
  it('renders shared citation title, description, and aside content', () => {
    render(
      <RawCitationPanelHeader
        title="Focused Citation"
        description="Pinned timeline context"
        aside={<span>guild:alpha</span>}
      />,
    );

    expect(screen.getByText('Focused Citation')).toBeInTheDocument();
    expect(screen.getByText('Pinned timeline context')).toBeInTheDocument();
    expect(screen.getByText('guild:alpha')).toBeInTheDocument();
  });

  it('renders without aside content when none is provided', () => {
    render(<RawCitationPanelHeader title="Source Context" description="Nearby messages" />);

    expect(screen.getByText('Source Context')).toBeInTheDocument();
    expect(screen.getByText('Nearby messages')).toBeInTheDocument();
  });
});
