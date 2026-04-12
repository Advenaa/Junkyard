import type { FormEvent, ReactNode } from 'react';
import { Modal } from './Modal.js';

interface ModalFormProps {
  open: boolean;
  onClose: () => void;
  title: string;
  submitLabel?: string;
  submittingLabel?: string;
  submitting?: boolean;
  submitDisabled?: boolean;
  error?: string | null;
  onSubmit: () => void;
  children: ReactNode;
}

export function ModalForm({
  open,
  onClose,
  title,
  submitLabel = 'Save',
  submittingLabel = 'Saving...',
  submitting = false,
  submitDisabled = false,
  error = null,
  onSubmit,
  children,
}: ModalFormProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <p className="text-red-400 text-sm font-body">{error}</p> : null}
        {children}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-surface-raised border border-border rounded-lg text-text-secondary text-sm font-body hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || submitDisabled}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-body hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submitting ? submittingLabel : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
