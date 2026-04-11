import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chat } from '../Chat';

vi.mock('../../components/StatusProvider', () => {
  const statusValue = {
    ready: true,
    status: null,
    disabledFeatures: [],
    isFeatureDisabled: () => false,
    getDisabledFeature: () => null,
    registerDisabledFeature: vi.fn(),
  };

  return { useStatus: () => statusValue };
});

function createPendingChatFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(url, 'http://localhost').pathname;

    if (path === '/api/v1/chat') {
      return new Promise<Response>(() => {});
    }

    throw new Error(`Unhandled fetch ${path}`);
  });
}

describe('Chat', () => {
  beforeEach(() => {
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it('clears loading state when user clicks New Chat mid-request', async () => {
    vi.stubGlobal('fetch', createPendingChatFetch());

    render(<Chat />);

    const user = userEvent.setup();
    const input = screen.getByLabelText('Chat message input');
    const sendButton = screen.getByRole('button', { name: 'Send message' });
    const newChatButton = screen.getByRole('button', { name: 'Start new chat conversation' });

    await user.type(input, 'What moved BTC today?');
    await user.click(sendButton);

    await screen.findByText(/Analyzing\.\.\./);
    expect(sendButton).toBeDisabled();

    await user.type(input, 'Draft next question');
    expect(input).toHaveValue('Draft next question');

    await user.click(newChatButton);

    await waitFor(() => {
      expect(screen.queryByText(/Analyzing\.\.\./)).not.toBeInTheDocument();
    });
    expect(screen.getByText('Ask anything about your market intelligence data.')).toBeInTheDocument();
    expect(input).toHaveValue('');

    await user.type(input, 'Fresh question');
    expect(sendButton).toBeEnabled();
  });

  it('keeps New Chat clickable during an in-flight request', async () => {
    vi.stubGlobal('fetch', createPendingChatFetch());

    render(<Chat />);

    const user = userEvent.setup();
    const input = screen.getByLabelText('Chat message input');
    const sendButton = screen.getByRole('button', { name: 'Send message' });
    const newChatButton = screen.getByRole('button', { name: 'Start new chat conversation' });

    await user.type(input, 'Show me the latest ETH flow');
    await user.click(sendButton);

    await screen.findByText(/Analyzing\.\.\./);
    expect(newChatButton).not.toBeDisabled();
  });
});
