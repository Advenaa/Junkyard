import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RawContextWindowControls } from '../RawContextWindowControls';

describe('RawContextWindowControls', () => {
  it('shows the shared context window label and expand action', async () => {
    const user = userEvent.setup();
    const onExpandContext = vi.fn();

    render(<RawContextWindowControls contextSize={3} canExpandContext onExpandContext={onExpandContext} />);

    expect(screen.getByText('Up to 3 before and after')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show more context' }));
    expect(onExpandContext).toHaveBeenCalledOnce();
  });

  it('shows the shared loading note without an action button', () => {
    render(<RawContextWindowControls contextSize={5} loading />);

    expect(screen.getByText('Up to 5 before and after')).toBeInTheDocument();
    expect(screen.getByText('Loading more context...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more context' })).not.toBeInTheDocument();
  });

  it('shows the shared retry action when the wider context load fails', async () => {
    const user = userEvent.setup();
    const onRetryContext = vi.fn();

    render(
      <RawContextWindowControls
        contextSize={6}
        error="Unable to load more context. Please try again."
        onRetryContext={onRetryContext}
      />,
    );

    expect(screen.getByText('Unable to load more context. Please try again.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry context' }));
    expect(onRetryContext).toHaveBeenCalledOnce();
  });
});
