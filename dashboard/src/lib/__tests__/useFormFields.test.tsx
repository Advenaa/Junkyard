import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFormFields } from '../useFormFields';

describe('useFormFields', () => {
  it('initializes with defaults', () => {
    const { result } = renderHook(() =>
      useFormFields({
        defaults: {
          discordId: '',
          role: 'viewer',
        },
      }),
    );

    expect(result.current.values).toEqual({ discordId: '', role: 'viewer' });
    expect(result.current.errors).toEqual({});
    expect(result.current.dirty).toBe(false);
  });

  it('setValue updates a field value', () => {
    const { result } = renderHook(() =>
      useFormFields({
        defaults: {
          discordId: '',
          role: 'viewer',
        },
      }),
    );

    act(() => {
      result.current.setValue('discordId', '123456789012345678');
    });

    expect(result.current.values.discordId).toBe('123456789012345678');
  });

  it('dirty tracks changes from defaults', () => {
    const { result } = renderHook(() =>
      useFormFields({
        defaults: {
          discordId: '',
          role: 'viewer',
        },
      }),
    );

    expect(result.current.dirty).toBe(false);

    act(() => {
      result.current.setValue('discordId', '123456789012345678');
    });

    expect(result.current.dirty).toBe(true);

    act(() => {
      result.current.setValue('discordId', '');
    });

    expect(result.current.dirty).toBe(false);
  });

  it('reset restores defaults and clears errors', () => {
    const { result } = renderHook(() =>
      useFormFields({
        defaults: {
          discordId: '',
          role: 'viewer',
        },
      }),
    );

    act(() => {
      result.current.setValue('discordId', '123456789012345678');
      result.current.setError('discordId', 'Discord IDs must be 17-20 digits.');
    });

    expect(result.current.values.discordId).toBe('123456789012345678');
    expect(result.current.errors.discordId).toBe('Discord IDs must be 17-20 digits.');

    act(() => {
      result.current.reset();
    });

    expect(result.current.values).toEqual({ discordId: '', role: 'viewer' });
    expect(result.current.errors).toEqual({});
  });

  it('validate sets errors and returns false on invalid values', () => {
    const { result } = renderHook(() =>
      useFormFields({
        defaults: {
          discordId: '',
          role: 'viewer',
        },
        validate: (values) => {
          if (!values.discordId) {
            return { discordId: 'Discord ID is required.' };
          }
          return null;
        },
      }),
    );

    let isValid = true;
    act(() => {
      isValid = result.current.validate();
    });

    expect(isValid).toBe(false);
    expect(result.current.errors).toEqual({ discordId: 'Discord ID is required.' });
  });
});
