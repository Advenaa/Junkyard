import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CollapsibleSection } from '../CollapsibleSection';

function getContentWrapper(childText: string) {
  return screen.getByText(childText).parentElement?.parentElement;
}

describe('CollapsibleSection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the title', () => {
    render(
      <CollapsibleSection title="Narratives">
        <div>Body content</div>
      </CollapsibleSection>,
    );

    expect(screen.getByRole('button', { name: /narratives/i })).toBeInTheDocument();
  });

  it('starts collapsed by default', () => {
    render(
      <CollapsibleSection title="Narratives">
        <div>Collapsed content</div>
      </CollapsibleSection>,
    );

    expect(getContentWrapper('Collapsed content')).toHaveStyle({ maxHeight: '0' });
  });

  it('toggles open when clicked', () => {
    render(
      <CollapsibleSection title="Narratives">
        <div>Toggle content</div>
      </CollapsibleSection>,
    );

    fireEvent.click(screen.getByRole('button', { name: /narratives/i }));

    expect(getContentWrapper('Toggle content')).toHaveStyle({ maxHeight: '2000px' });
  });

  it('starts expanded when defaultOpen is true', () => {
    render(
      <CollapsibleSection title="Narratives" defaultOpen>
        <div>Expanded content</div>
      </CollapsibleSection>,
    );

    expect(getContentWrapper('Expanded content')).toHaveStyle({ maxHeight: '2000px' });
  });

  it('shows the summary only when collapsed', () => {
    render(
      <CollapsibleSection title="Narratives" summary="Three active clusters">
        <div>Summary content</div>
      </CollapsibleSection>,
    );

    expect(screen.getByText('Three active clusters')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /narratives/i }));

    expect(screen.queryByText('Three active clusters')).not.toBeInTheDocument();
  });

  it('persists open state to localStorage when a storage key is provided', () => {
    render(
      <CollapsibleSection title="Narratives" storageKey="market-view">
        <div>Persistent content</div>
      </CollapsibleSection>,
    );

    fireEvent.click(screen.getByRole('button', { name: /narratives/i }));

    expect(localStorage.getItem('collapsible-market-view')).toBe('true');
  });
});
