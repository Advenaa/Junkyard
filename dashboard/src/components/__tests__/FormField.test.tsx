import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormField } from '../FormField';

describe('FormField', () => {
  it('renders the label and children', () => {
    render(
      <FormField label="Discord ID">
        <input aria-label="Discord ID input" />
      </FormField>,
    );

    expect(screen.getByText('Discord ID')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Discord ID input' })).toBeInTheDocument();
  });

  it('renders the optional indicator', () => {
    render(
      <FormField label="Webhook URL" optional>
        <input aria-label="Webhook URL input" />
      </FormField>,
    );

    expect(screen.getByText('(optional)')).toBeInTheDocument();
  });

  it('renders the error when provided', () => {
    render(
      <FormField label="Discord ID" error="Discord IDs must be 17-20 digits.">
        <input aria-label="Discord ID input" />
      </FormField>,
    );

    expect(screen.getByText('Discord IDs must be 17-20 digits.')).toBeInTheDocument();
  });

  it('does not render an error when null', () => {
    render(
      <FormField label="Discord ID" error={null}>
        <input aria-label="Discord ID input" />
      </FormField>,
    );

    expect(screen.queryByText('Discord IDs must be 17-20 digits.')).not.toBeInTheDocument();
  });
});
