import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Modal } from '../components/Modal';
import { apiFetch } from '../lib/api';

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "You're not authorized \u2014 ask an admin to invite you",
  blocked: 'Your access has been blocked',
};

export function Login() {
  const [params] = useSearchParams();
  const error = params.get('error');
  const message = error ? (ERROR_MESSAGES[error] ?? 'An error occurred') : null;
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [discordId, setDiscordId] = useState('');
  const [requestedRole, setRequestedRole] = useState<'viewer' | 'admin'>('viewer');
  const [note, setNote] = useState('');
  const [requestSaving, setRequestSaving] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestSuccess, setRequestSuccess] = useState<string | null>(null);

  const openRequestModal = () => {
    setDiscordId('');
    setRequestedRole('viewer');
    setNote('');
    setRequestError(null);
    setRequestModalOpen(true);
  };

  const submitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedDiscordId = discordId.trim();
    if (!trimmedDiscordId) return;

    setRequestSaving(true);
    setRequestError(null);
    try {
      const { csrfToken } = await apiFetch<{ csrfToken: string }>('/access-requests/csrf');
      await apiFetch('/access-requests', {
        method: 'POST',
        headers: {
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          discordId: trimmedDiscordId,
          requestedRole,
          note: note.trim() || undefined,
        }),
      });
      setRequestModalOpen(false);
      setRequestSuccess('Access request sent. An admin can review it from Settings > Users.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send request.';
      if (message.includes('429')) {
        setRequestError('Too many requests from this network. Please try again later.');
      } else if (message.includes('403')) {
        setRequestError('Request verification expired. Please try again.');
      } else if (message.includes('400')) {
        setRequestError('Discord IDs must be 17-20 digits.');
      } else {
        setRequestError('Failed to send request.');
      }
    } finally {
      setRequestSaving(false);
    }
  };

  const requestModal = (
    <Modal open={requestModalOpen} onClose={() => setRequestModalOpen(false)} title="Request Access">
      <form onSubmit={submitRequest} className="space-y-4">
        {requestError && <p className="text-accent-red text-sm font-body">{requestError}</p>}
        <div className="space-y-1.5">
          <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Discord ID</label>
          <input
            type="text"
            required
            value={discordId}
            onChange={(e) => setDiscordId(e.target.value)}
            placeholder="123456789012345678"
            className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-mono placeholder:text-[#555566] focus:outline-none focus:border-accent"
          />
          <p className="text-xs text-text-secondary/70 font-body">
            Use the numeric Discord account ID you want an admin to review.
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Requested Role</label>
          <select
            value={requestedRole}
            onChange={(e) => setRequestedRole(e.target.value as 'viewer' | 'admin')}
            className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
          >
            <option value="viewer">viewer</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">
            Note <span className="normal-case text-text-secondary/60">(optional)</span>
          </label>
          <textarea
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why do you need access?"
            className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body placeholder:text-[#555566] focus:outline-none focus:border-accent"
          />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => setRequestModalOpen(false)}
            className="px-4 py-2 bg-surface-raised border border-border rounded-lg text-text-secondary text-sm font-body hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={requestSaving || !discordId.trim()}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-body hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {requestSaving ? 'Sending...' : 'Send Request'}
          </button>
        </div>
      </form>
    </Modal>
  );

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      {requestModal}
      <div className="text-center">
        <h1 className="font-heading text-4xl text-text-primary mb-10">Podders</h1>
        <a
          href="/api/v1/auth/discord"
          className="inline-block px-8 py-3 bg-accent text-white rounded-lg font-body text-sm hover:opacity-90 transition-opacity"
        >
          Sign in with Discord
        </a>
        <div className="mt-4">
          <button
            onClick={openRequestModal}
            className="px-6 py-2.5 bg-surface-raised border border-border rounded-lg font-body text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Request Access
          </button>
        </div>
        {message && <p className="mt-6 text-accent-red text-sm font-body">{message}</p>}
        {requestSuccess && <p className="mt-4 text-accent-green text-sm font-body">{requestSuccess}</p>}
      </div>
    </div>
  );
}
