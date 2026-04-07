import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { Settings } from '../Settings';

vi.mock('../../components/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      discordId: '123456789012345678',
      username: 'twitter-admin',
      avatar: null,
      role: 'admin' as const,
    },
    loading: false,
    logout: vi.fn(),
  }),
}));

// ── Helpers ────────────────────────────────────────────────────────────

interface MockOptions {
  sources?: Array<{
    source: string;
    sourceId: string;
    label: string | null;
    enabled: boolean;
    pollInterval: number;
    lastFetchedAt: number | null;
    errorCount: number;
    lastError: string | null;
    status: string;
    stateStatus: string | null;
  }>;
  twitterApiKeyConfigured?: boolean;
}

function buildFetchMock(options: MockOptions = {}) {
  const { sources = [], twitterApiKeyConfigured = true } = options;

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(url, 'http://localhost');
    const path = parsed.pathname;
    const method = init?.method ?? 'GET';

    // Sources list
    if (path === '/api/v1/sources' && method === 'GET') {
      return new Response(JSON.stringify({ sources }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Discord tokens
    if (path === '/api/v1/discord/tokens' && method === 'GET') {
      return new Response(JSON.stringify({ tokens: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/v1/discord/tokens/health' && method === 'GET') {
      return new Response(JSON.stringify({ states: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Status endpoint (returns twitterApiKeyConfigured)
    if (path === '/api/v1/status' && method === 'GET') {
      return new Response(
        JSON.stringify({
          itemsReady: 0,
          itemsProcessing: 0,
          summariesToday: 0,
          costToday: 0,
          twitterApiKeyConfigured,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Add source
    if (path === '/api/v1/sources' && method === 'POST') {
      const body = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          source: body.source,
          sourceId: body.sourceId,
          label: body.label ?? null,
          enabled: true,
          pollInterval: body.poll_interval ?? 300,
          lastFetchedAt: null,
          errorCount: 0,
          lastError: null,
          status: 'ready',
          stateStatus: 'active',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    }

    throw new Error(`Unhandled fetch ${method} ${path}${parsed.search}`);
  });
}

function makeTwitterSource(overrides: Partial<NonNullable<MockOptions['sources']>[number]> = {}) {
  return {
    source: 'twitter',
    sourceId: '@vabortnews',
    label: null,
    enabled: true,
    pollInterval: 300,
    lastFetchedAt: null,
    errorCount: 0,
    lastError: null,
    status: 'ready',
    stateStatus: 'active',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════

describe('Settings Twitter source management', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows Twitter placeholder mentioning @username and search query when adding a Twitter source', async () => {
    vi.stubGlobal('fetch', buildFetchMock({ twitterApiKeyConfigured: true }));

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    // Wait for the Sources tab to be active (admin default)
    await screen.findByText('Sources');

    // Click "Add Source" button
    const addButton = await screen.findByRole('button', { name: /add source/i });
    await user.click(addButton);

    // Wait for the modal to open
    await screen.findByRole('dialog');

    // Switch to Twitter source type
    const sourceTypeSelect = screen.getByDisplayValue('discord');
    await user.selectOptions(sourceTypeSelect, 'twitter');

    // Verify the Source ID input has a placeholder mentioning @username and search query
    const sourceIdInput = screen.getByPlaceholderText(/@username.*search query|search query.*@username/i);
    expect(sourceIdInput).toBeInTheDocument();
  });

  it('shows API key warning when twitterApiKeyConfigured is false', async () => {
    vi.stubGlobal('fetch', buildFetchMock({ twitterApiKeyConfigured: false }));

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await screen.findByText('Sources');

    // Open the add source modal
    const addButton = await screen.findByRole('button', { name: /add source/i });
    await user.click(addButton);
    await screen.findByRole('dialog');

    // Select Twitter source type
    const sourceTypeSelect = screen.getByDisplayValue('discord');
    await user.selectOptions(sourceTypeSelect, 'twitter');

    // Wait for the API key warning to appear (status endpoint is fetched when switching to twitter)
    await waitFor(() => {
      expect(
        screen.getByText(/TWITTERAPI_KEY.*not configured|Twitter API key.*not configured/i),
      ).toBeInTheDocument();
    });
  });

  it('does NOT show API key warning when twitterApiKeyConfigured is true', async () => {
    vi.stubGlobal('fetch', buildFetchMock({ twitterApiKeyConfigured: true }));

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await screen.findByText('Sources');

    const addButton = await screen.findByRole('button', { name: /add source/i });
    await user.click(addButton);
    await screen.findByRole('dialog');

    const sourceTypeSelect = screen.getByDisplayValue('discord');
    await user.selectOptions(sourceTypeSelect, 'twitter');

    // Wait a tick for the status fetch to complete
    await waitFor(() => {
      expect(screen.queryByText(/TWITTERAPI_KEY.*not configured/i)).not.toBeInTheDocument();
    });
  });

  it('shows halted Twitter source with error message in the source list', async () => {
    const haltedSource = makeTwitterSource({
      sourceId: '@cryptonews',
      stateStatus: 'halted',
      lastError: '401 Unauthorized — Twitter API key may be invalid or expired',
      errorCount: 5,
    });

    vi.stubGlobal('fetch', buildFetchMock({ sources: [haltedSource] }));

    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    // Wait for the source list to load and display the halted source
    await waitFor(() => {
      expect(screen.getByText('halted')).toBeInTheDocument();
    });

    // The error message should be visible
    expect(
      screen.getByText(/401 Unauthorized|API key.*invalid|API key.*expired/i),
    ).toBeInTheDocument();
  });

  it('shows Twitter handle source in the source list', async () => {
    const handleSource = makeTwitterSource({
      sourceId: '@ethtrader',
      label: null,
    });

    vi.stubGlobal('fetch', buildFetchMock({ sources: [handleSource] }));

    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    // Wait for the source list to show the @handle sourceId as the display name
    await waitFor(() => {
      expect(screen.getByText('@ethtrader')).toBeInTheDocument();
    });

    // The source type column should show "twitter"
    expect(screen.getByText('twitter')).toBeInTheDocument();
  });

  it('shows Twitter search source in the source list', async () => {
    const searchSource = makeTwitterSource({
      sourceId: 'ethereum OR defi',
      label: 'ETH & DeFi search',
    });

    vi.stubGlobal('fetch', buildFetchMock({ sources: [searchSource] }));

    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    // The label should be used as display name when present
    await waitFor(() => {
      expect(screen.getByText('ETH & DeFi search')).toBeInTheDocument();
    });
  });

  it('shows help text about @handle vs search query when Twitter is selected', async () => {
    vi.stubGlobal('fetch', buildFetchMock({ twitterApiKeyConfigured: true }));

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await screen.findByText('Sources');

    const addButton = await screen.findByRole('button', { name: /add source/i });
    await user.click(addButton);
    await screen.findByRole('dialog');

    const sourceTypeSelect = screen.getByDisplayValue('discord');
    await user.selectOptions(sourceTypeSelect, 'twitter');

    // Help text should mention @handle for user timelines and search query support
    await waitFor(() => {
      expect(screen.getByText(/@handle.*user timeline|Use @handle/i)).toBeInTheDocument();
    });
  });

  it('disables toggle for halted Twitter source and shows halted tooltip', async () => {
    const haltedSource = makeTwitterSource({
      sourceId: '@badkey',
      stateStatus: 'halted',
      lastError: '401 Unauthorized',
    });

    vi.stubGlobal('fetch', buildFetchMock({ sources: [haltedSource] }));

    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    // Wait for the source to render
    await waitFor(() => {
      expect(screen.getByText('halted')).toBeInTheDocument();
    });

    // The toggle button should be disabled for halted sources
    const toggleButton = screen.getByTitle(/halted.*fix the underlying issue/i);
    expect(toggleButton).toBeDisabled();
  });
});
