import { useState } from 'react';

interface UseFormFieldsOptions<T extends Record<string, unknown>> {
  defaults: T;
  validate?: (values: T) => Partial<Record<keyof T, string>> | null;
}

interface UseFormFieldsResult<T extends Record<string, unknown>> {
  values: T;
  errors: Partial<Record<keyof T, string>>;
  dirty: boolean;
  setValue: <K extends keyof T>(key: K, value: T[K]) => void;
  setError: (key: keyof T, message: string | null) => void;
  reset: () => void;
  validate: () => boolean;
}

function copyValues<T extends Record<string, unknown>>(values: T): T {
  return { ...values };
}

function normalizeErrors<T extends Record<string, unknown>>(
  errors: Partial<Record<keyof T, string>> | null | undefined,
): Partial<Record<keyof T, string>> {
  if (!errors) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(errors).filter(([, message]) => typeof message === 'string' && message.length > 0),
  ) as Partial<Record<keyof T, string>>;
}

export function useFormFields<T extends Record<string, unknown>>({
  defaults,
  validate: validateValues,
}: UseFormFieldsOptions<T>): UseFormFieldsResult<T> {
  const [values, setValues] = useState<T>(() => copyValues(defaults));
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});

  const dirty = (Object.keys(defaults) as Array<keyof T>).some((key) => !Object.is(values[key], defaults[key]));

  const setValue = <K extends keyof T>(key: K, value: T[K]) => {
    setValues((currentValues) => ({ ...currentValues, [key]: value }));
    setErrors((currentErrors) => {
      if (!(key in currentErrors)) {
        return currentErrors;
      }
      const nextErrors = { ...currentErrors };
      delete nextErrors[key];
      return nextErrors;
    });
  };

  const setError = (key: keyof T, message: string | null) => {
    setErrors((currentErrors) => {
      const nextErrors = { ...currentErrors };
      if (message) {
        nextErrors[key] = message;
      } else {
        delete nextErrors[key];
      }
      return nextErrors;
    });
  };

  const reset = () => {
    setValues(copyValues(defaults));
    setErrors({});
  };

  const validate = () => {
    const nextErrors = normalizeErrors(validateValues?.(values));
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  return {
    values,
    errors,
    dirty,
    setValue,
    setError,
    reset,
    validate,
  };
}

export type { UseFormFieldsOptions, UseFormFieldsResult };
