import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusProvider, useStatus } from '../StatusProvider';
import type { DisabledFeatureSummary, StatusSnapshot } from '../../lib/types';

// Always behave as a logged-in admin so StatusProvider actually fires the
// `/status` fetch (it short-circuits when there is no user). The returned
// object MUST be referentially stable — StatusProvider's effect depends on
// `[user, authLoading]`, so a fresh object every render would re-fire the
// fetch on every commit and wipe `discovered` state between clicks.
vi.mock('../AuthProvider', () => {
  const user = {
    discordId: '123456789012345678',
    username: 'status-probe',
    avatar: null,
    role: 'admin' as const,
  };
  const logout = () => {};
  const authValue = { user, loading: false, logout };
  return { useAuth: () => authValue };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ── Probe child ────────────────────────────────────────────────────────
// Surfaces every StatusContext field so the test can assert against the DOM
// instead of reaching into hook internals. Also exposes a button that calls
// `registerDisabledFeature` so idempotence can be verified by user-event.

function StatusProbe({ registerFeature }: { registerFeature?: DisabledFeatureSummary }) {
  const { ready, status, disabledFeatures, isFeatureDisabled, getDisabledFeature, registerDisabledFeature } =
    useStatus();
  return (
    <div>
      <div data-testid="ready">{ready ? 'ready' : 'loading'}</div>
      <div data-testid="has-status">{status ? 'yes' : 'no'}</div>
      <div data-testid="count">{disabledFeatures.length}</div>
      <div data-testid="macro-disabled">{isFeatureDisabled('macro') ? 'yes' : 'no'}</div>
      <div data-testid="embeddings-disabled">{isFeatureDisabled('embeddings') ? 'yes' : 'no'}</div>
      <div data-testid="prices-disabled">{isFeatureDisabled('prices') ? 'yes' : 'no'}</div>
      <div data-testid="macro-env">{getDisabledFeature('macro')?.missingEnv ?? ''}</div>
      <button
        type="button"
        data-testid="register"
        onClick={() => {
          if (registerFeature) registerDisabledFeature(registerFeature);
        }}
      >
        register
      </button>
    </div>
  );
}

function mountProbe(props: { registerFeature?: DisabledFeatureSummary } = {}) {
  return render(
    <StatusProvider>
      <StatusProbe {...props} />
    </StatusProvider>,
  );
}

// ── Fetch mocks ────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockStatusFetch(snapshot: StatusSnapshot | 'reject') {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(url, 'http://localhost');
    if (parsed.pathname !== '/api/v1/status') {
      return new Response(JSON.stringify({}), { status: 404 });
    }
    if (snapshot === 'reject') {
      throw new Error('network down');
    }
    return jsonResponse(snapshot);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('StatusProvider (M-010 runtime regression)', () => {
  it('flips `ready` to true after /status settles and exposes the disabled features', async () => {
    mockStatusFetch({
      itemsReady: 0,
      itemsProcessing: 0,
      summariesToday: 0,
      costToday: 0,
      disabledFeatures: [
        { feature: 'macro', missingEnv: 'FRED_API_KEY', disables: ['macro snapshots', 'regime detection'] },
      ],
    });

    mountProbe();

    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('ready'));
    expect(screen.getByTestId('has-status').textContent).toBe('yes');
    expect(screen.getByTestId('count').textContent).toBe('1');
    expect(screen.getByTestId('macro-disabled').textContent).toBe('yes');
    expect(screen.getByTestId('macro-env').textContent).toBe('FRED_API_KEY');
    expect(screen.getByTestId('embeddings-disabled').textContent).toBe('no');
    expect(screen.getByTestId('prices-disabled').textContent).toBe('no');
  });

  it('treats a pending /status fetch as "not disabled" — consumers must gate on `ready`', async () => {
    // Never-resolving fetch: the provider stays in the loading state so we can
    // assert the pre-resolution contract. While `ready` is still false,
    // isFeatureDisabled MUST return false for every feature — that is the
    // documented load-order invariant consumer effects rely on when they
    // early-return on `!statusReady`.
    const neverResolves = new Promise<Response>(() => {
      // intentionally never resolves: we only care about the pre-resolution
      // DOM, and the provider is torn down by afterEach's cleanup().
    });
    const fetchMock = vi.fn(async () => neverResolves);
    vi.stubGlobal('fetch', fetchMock);

    mountProbe();

    expect(screen.getByTestId('ready').textContent).toBe('loading');
    expect(screen.getByTestId('has-status').textContent).toBe('no');
    expect(screen.getByTestId('count').textContent).toBe('0');
    expect(screen.getByTestId('macro-disabled').textContent).toBe('no');
    expect(screen.getByTestId('embeddings-disabled').textContent).toBe('no');
    expect(screen.getByTestId('prices-disabled').textContent).toBe('no');
  });

  it('flips `ready` to true on fetch failure with an empty disabled-features map (safety net reachable)', async () => {
    // Suppress jsdom's unhandled-rejection noise from the catch branch.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockStatusFetch('reject');

    mountProbe();

    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('ready'));
    // status is null, disabledFeatures falls back to [] — so consumers will
    // try their endpoints and rely on the `registerDisabledFeature` catch path
    // to promote any slipped-through 503 into the shared map.
    expect(screen.getByTestId('has-status').textContent).toBe('no');
    expect(screen.getByTestId('count').textContent).toBe('0');
    expect(screen.getByTestId('macro-disabled').textContent).toBe('no');
    errorSpy.mockRestore();
  });

  it('registerDisabledFeature promotes locally-discovered 503 errors into the shared map (cycle 386 fix)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockStatusFetch('reject');

    mountProbe({
      registerFeature: {
        feature: 'embeddings',
        missingEnv: 'GEMINI_API_KEY',
        disables: ['semantic search', 'RAG chat'],
      },
    });

    // Wait until the provider is ready (fetch rejected).
    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('ready'));
    expect(screen.getByTestId('embeddings-disabled').textContent).toBe('no');

    // Consumer catch handler discovers a 503 and calls registerDisabledFeature;
    // the provider should merge it into the shared map immediately.
    const user = userEvent.setup();
    await user.click(screen.getByTestId('register'));
    await waitFor(() => expect(screen.getByTestId('embeddings-disabled').textContent).toBe('yes'));
    expect(screen.getByTestId('count').textContent).toBe('1');

    // Clicking a second time with the same feature must be idempotent.
    await user.click(screen.getByTestId('register'));
    expect(screen.getByTestId('count').textContent).toBe('1');
    errorSpy.mockRestore();
  });

  it('merges discovered entries with /status entries without double-counting', async () => {
    mockStatusFetch({
      itemsReady: 0,
      itemsProcessing: 0,
      summariesToday: 0,
      costToday: 0,
      disabledFeatures: [{ feature: 'macro', missingEnv: 'FRED_API_KEY', disables: ['macro snapshots'] }],
    });

    mountProbe({
      registerFeature: {
        feature: 'prices',
        missingEnv: 'COINGECKO_API_KEY',
        disables: ['price feeds'],
      },
    });

    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('ready'));
    expect(screen.getByTestId('count').textContent).toBe('1');
    expect(screen.getByTestId('macro-disabled').textContent).toBe('yes');

    const user = userEvent.setup();
    await user.click(screen.getByTestId('register'));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
    expect(screen.getByTestId('prices-disabled').textContent).toBe('yes');
    expect(screen.getByTestId('macro-disabled').textContent).toBe('yes');

    // Re-clicking the same feature registered above must not add a duplicate
    // entry — the merge path in StatusProvider dedupes by feature key.
    await user.click(screen.getByTestId('register'));
    expect(screen.getByTestId('count').textContent).toBe('2');
  });
});
