import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RawCitationSurface } from '../RawCitationSurface';

describe('RawCitationSurface', () => {
  it('renders shared citation-surface content inside the common panel shell', () => {
    render(
      <RawCitationSurface>
        <div>Shared citation surface</div>
      </RawCitationSurface>,
    );

    expect(screen.getByText('Shared citation surface')).toBeInTheDocument();
  });
});
