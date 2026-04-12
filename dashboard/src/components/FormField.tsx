import type { ReactNode } from 'react';

interface FormFieldProps {
  label: string;
  optional?: boolean;
  error?: string | null;
  children: ReactNode;
}

export function FormField({ label, optional = false, error = null, children }: FormFieldProps) {
  return (
    <div className="space-y-1.5">
      <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">
        {label}
        {optional ? <span className="normal-case text-text-secondary/60"> (optional)</span> : null}
      </label>
      {children}
      {error ? <p className="text-red-400 text-sm font-body">{error}</p> : null}
    </div>
  );
}
