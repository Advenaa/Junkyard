import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { StatusProvider } from '../StatusProvider';
import { ReportList } from '../../pages/ReportList';
import type { StatusSnapshot } from '../../lib/types';

// Keep the auth value referentially stable so StatusProvider's `/status` effect
// runs once per mount instead of re-firing on every render.
vi.mock('../AuthProvider', () => {
  const user = {
    discordId: '123456789012345678',
    username: 'status-consumer',
    avatar: null,
    role: 'admin' as const,
  };
  const logout = () => {};
  const authValue = { user, loading: false, logout };
  return { useAuth: () => authValue };
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createDeferredResponse() {
  let resolve!: (value: Response) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Response>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function getPath(input: RequestInfo | URL): string {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  return new URL(url, 'http://localhost').pathname;
}

function countPathCalls(fetchMock: ReturnType<typeof vi.fn>, path: string): number {
  return fetchMock.mock.calls.filter(([input]) => getPath(input as RequestInfo | URL) === path).length;
}

function firstPathCallIndex(fetchMock: ReturnType<typeof vi.fn>, path: string): number {
  return fetchMock.mock.calls.findIndex(([input]) => getPath(input as RequestInfo | URL) === path);
}

function renderReportList() {
  return render(
    <MemoryRouter initialEntries={['/reports']}>
      <StatusProvider>
        <Routes>
          <Route path="/reports" element={<ReportList />} />
        </Routes>
      </StatusProvider>
    </MemoryRouter>,
  );
}

function statusSnapshot(disabledFeatures: StatusSnapshot['disabledFeatures'] = []): StatusSnapshot {
  return {
    itemsReady: 0,
    itemsProcessing: 0,
    summariesToday: 0,
    costToday: 0,
    disabledFeatures,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StatusProvider real consumer regression coverage', () => {
  it('does not request /narratives before /status is ready, then fetches it once after readiness', async () => {
    const deferredStatus = createDeferredResponse();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = getPath(input);

      if (path === '/api/v1/status') {
        return deferredStatus.promise;
      }

      if (path === '/api/v1/reports') {
        return jsonResponse({ reports: [] });
      }

      if (path === '/api/v1/narratives') {
        return jsonResponse({
          latestDate: '2026-04-12',
          entries: [
            {
              id: 'narrative-1',
              name: 'AI infra bid',
              date: '2026-04-12',
              memberCount: 4,
              avgSentiment: 0.42,
              signalStrength: 'emerging',
            },
          ],
        });
      }

      throw new Error(`Unhandled fetch ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderReportList();

    await screen.findByText('Reports');
    await waitFor(() => {
      expect(countPathCalls(fetchMock, '/api/v1/status')).toBe(1);
      expect(countPathCalls(fetchMock, '/api/v1/reports')).toBe(1);
    });
    expect(countPathCalls(fetchMock, '/api/v1/narratives')).toBe(0);

    deferredStatus.resolve(jsonResponse(statusSnapshot()));

    await waitFor(() => {
      expect(countPathCalls(fetchMock, '/api/v1/narratives')).toBe(1);
    });
    await screen.findByText('AI infra bid');
    expect(firstPathCallIndex(fetchMock, '/api/v1/status')).toBeLessThan(
      firstPathCallIndex(fetchMock, '/api/v1/narratives'),
    );
    expect(screen.queryByTestId('feature-disabled-card')).not.toBeInTheDocument();
  });

  it('renders FeatureDisabledCard when /narratives returns a slipped-through 503 feature_disabled response', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = getPath(input);

      if (path === '/api/v1/status') {
        return jsonResponse(statusSnapshot());
      }

      if (path === '/api/v1/reports') {
        return jsonResponse({ reports: [] });
      }

      if (path === '/api/v1/narratives') {
        return jsonResponse(
          {
            error: 'feature_disabled',
            feature: 'embeddings',
            missingEnv: 'GEMINI_API_KEY',
            disables: ['narrative clustering'],
          },
          503,
        );
      }

      throw new Error(`Unhandled fetch ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderReportList();

    const disabledCard = await screen.findByTestId('feature-disabled-card');

    await waitFor(() => {
      expect(countPathCalls(fetchMock, '/api/v1/status')).toBe(1);
      expect(countPathCalls(fetchMock, '/api/v1/narratives')).toBe(1);
    });
    expect(firstPathCallIndex(fetchMock, '/api/v1/status')).toBeLessThan(
      firstPathCallIndex(fetchMock, '/api/v1/narratives'),
    );
    expect(disabledCard).toHaveAttribute('data-feature', 'embeddings');
    expect(screen.getByText('Narrative Snapshot')).toBeInTheDocument();
    expect(screen.getByText(/GEMINI_API_KEY/)).toBeInTheDocument();
  });
});
