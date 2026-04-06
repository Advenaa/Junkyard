import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RawTimelineDivider } from '../RawTimelineDivider';

describe('RawTimelineDivider', () => {
  it('renders the shared timeline handoff label', () => {
    render(<RawTimelineDivider label="Live feed resumes about 9 minutes later" />);

    expect(screen.getByText('Live feed resumes about 9 minutes later')).toBeInTheDocument();
  });
});
