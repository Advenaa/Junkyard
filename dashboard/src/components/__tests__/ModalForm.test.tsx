import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModalForm } from '../ModalForm';

describe('ModalForm', () => {
  it('renders the title, children, and submit button', () => {
    render(
      <ModalForm open onClose={() => {}} title="Invite User" onSubmit={() => {}}>
        <div>form fields</div>
      </ModalForm>,
    );

    expect(screen.getByRole('dialog', { name: 'Invite User' })).toBeInTheDocument();
    expect(screen.getByText('form fields')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('shows the error when provided', () => {
    render(
      <ModalForm open onClose={() => {}} title="Invite User" error="Failed to invite user." onSubmit={() => {}}>
        <div>form fields</div>
      </ModalForm>,
    );

    expect(screen.getByText('Failed to invite user.')).toBeInTheDocument();
  });

  it('calls onSubmit on form submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <ModalForm open onClose={() => {}} title="Invite User" onSubmit={onSubmit}>
        <input aria-label="Discord ID input" />
      </ModalForm>,
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('disables the submit button when submitting', () => {
    render(
      <ModalForm open onClose={() => {}} title="Invite User" submitting onSubmit={() => {}}>
        <div>form fields</div>
      </ModalForm>,
    );

    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
  });

  it('shows the submitting label when submitting', () => {
    render(
      <ModalForm
        open
        onClose={() => {}}
        title="Invite User"
        submitting
        submittingLabel="Inviting..."
        onSubmit={() => {}}
      >
        <div>form fields</div>
      </ModalForm>,
    );

    expect(screen.getByRole('button', { name: 'Inviting...' })).toBeInTheDocument();
  });
});
