import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Settings } from '../Settings';

vi.mock('../../components/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      discordId: '123456789012345678',
      username: 'calendar-admin',
      avatar: null,
      role: 'admin' as const,
    },
    loading: false,
    logout: vi.fn(),
  }),
}));
vi.mock('../../components/StatusProvider', () => {
  const statusValue = {
    ready: true,
    status: { itemsReady: 0, itemsProcessing: 0, summariesToday: 0, costToday: 0, disabledFeatures: [] },
    disabledFeatures: [],
    isFeatureDisabled: () => false,
    getDisabledFeature: () => null,
    registerDisabledFeature: vi.fn(),
  };
  return { useStatus: () => statusValue };
});

interface MockCalendarEvent {
  id: string;
  name: string;
  category: 'macro' | 'unlock' | 'expiry' | 'governance' | 'launch' | 'legal' | 'custom';
  description: string | null;
  recurrenceRule: string | null;
  entityId: string | null;
  entityName: string | null;
  nextOccurrence: number;
  createdAt: number;
}

describe('Settings market calendar', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lets admins add, edit, and remove upcoming market calendar events from the Pipeline tab', async () => {
    const calendarEvents: MockCalendarEvent[] = [];
    const knownEntities = [
      { id: 'ent-bitcoin', name: 'Bitcoin', matchedAlias: 'btc' },
      { id: 'ent-ethereum', name: 'Ethereum', matchedAlias: 'eth' },
      { id: 'ent-arbitrum', name: 'Arbitrum', matchedAlias: 'arb' },
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const requestUrl = new URL(url, 'http://localhost');
        const path = requestUrl.pathname;
        const method = init?.method ?? 'GET';

        if (path === '/api/v1/sources' && method === 'GET') {
          return new Response(JSON.stringify({ sources: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

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

        if (path === '/api/v1/status' && method === 'GET') {
          return new Response(
            JSON.stringify({ itemsReady: 4, itemsProcessing: 1, summariesToday: 9, costToday: 1.42 }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        if (path === '/api/v1/health' && method === 'GET') {
          return new Response(JSON.stringify({ status: 'ok', checks: { db: 'ok', ingest: 'ok' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/config' && method === 'GET') {
          return new Response(JSON.stringify({ digestTime: '09:00', timezone: 'Asia/Jakarta', webhookUrl: '' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/calendar-events' && method === 'GET') {
          return new Response(JSON.stringify({ events: calendarEvents }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/macro' && method === 'GET') {
          return new Response(JSON.stringify({ error: 'No macro data available yet' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/unusual-activity' && method === 'GET') {
          return new Response(JSON.stringify({ latestDate: '2026-04-08', entries: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/narratives' && method === 'GET') {
          return new Response(JSON.stringify({ latestDate: '2026-04-08', entries: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/entities/search' && method === 'GET') {
          const q = requestUrl.searchParams.get('q')?.toLowerCase() ?? '';
          const entities = knownEntities.filter(
            (entity) => entity.name.toLowerCase().startsWith(q) || entity.matchedAlias.startsWith(q),
          );
          return new Response(JSON.stringify({ entities }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path === '/api/v1/calendar-events' && method === 'POST') {
          const payload = JSON.parse(String(init?.body ?? '{}')) as {
            name: string;
            category: MockCalendarEvent['category'];
            entityName?: string | null;
            description?: string;
            scheduledFor: number;
          };
          const event: MockCalendarEvent = {
            id: `cal-${calendarEvents.length + 1}`,
            name: payload.name,
            category: payload.category,
            description: payload.description ?? null,
            recurrenceRule: null,
            entityId: payload.entityName ? `ent-${payload.entityName.toLowerCase()}` : null,
            entityName: payload.entityName ?? null,
            nextOccurrence: payload.scheduledFor,
            createdAt: Date.now(),
          };
          calendarEvents.push(event);
          calendarEvents.sort((a, b) => a.nextOccurrence - b.nextOccurrence);
          return new Response(JSON.stringify({ event }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path.startsWith('/api/v1/calendar-events/') && method === 'PATCH') {
          const eventId = path.split('/').pop();
          const payload = JSON.parse(String(init?.body ?? '{}')) as {
            name: string;
            category: MockCalendarEvent['category'];
            entityName?: string | null;
            description?: string | null;
            recurrenceRule?: MockCalendarEvent['recurrenceRule'];
            scheduledFor: number;
          };
          const event = calendarEvents.find((entry) => entry.id === eventId);
          if (!event) {
            return new Response(JSON.stringify({ error: 'Calendar event not found' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          event.name = payload.name;
          event.category = payload.category;
          event.description = payload.description ?? null;
          event.recurrenceRule = payload.recurrenceRule ?? null;
          event.entityId = payload.entityName ? `ent-${payload.entityName.toLowerCase()}` : null;
          event.entityName = payload.entityName ?? null;
          event.nextOccurrence = payload.scheduledFor;
          calendarEvents.sort((a, b) => a.nextOccurrence - b.nextOccurrence);
          return new Response(JSON.stringify({ event }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (path.startsWith('/api/v1/calendar-events/') && method === 'DELETE') {
          const eventId = path.split('/').pop();
          const index = calendarEvents.findIndex((event) => event.id === eventId);
          if (index === -1) {
            return new Response(JSON.stringify({ error: 'Calendar event not found' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          calendarEvents.splice(index, 1);
          return new Response(null, { status: 204 });
        }

        throw new Error(`Unhandled fetch ${method} ${path}`);
      }),
    );

    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByRole('button', { name: 'Pipeline' }));
    await screen.findByText('Market Calendar');
    expect(screen.getByText('No upcoming catalysts')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add Event' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add Market Calendar Event' });

    await user.type(within(dialog).getByPlaceholderText('FOMC rate decision'), 'FOMC rate decision');
    fireEvent.change(dialog.querySelector('input[type="datetime-local"]')!, {
      target: { value: '2030-01-02T10:30' },
    });
    const addEntityField = within(dialog).getByPlaceholderText('Optional: Bitcoin, ETH, Arbitrum');
    await user.type(addEntityField, 'Bit');
    await user.click(await within(dialog).findByRole('button', { name: /Bitcoin/i }));
    await user.type(
      within(dialog).getByPlaceholderText('Optional trader-facing context, such as expected impact or asset scope.'),
      'Fed guidance can reset macro risk appetite.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add Event' }));

    await screen.findByText('FOMC rate decision');
    expect(screen.getByText('Fed guidance can reset macro risk appetite.')).toBeInTheDocument();
    expect(screen.getByText('One-time')).toBeInTheDocument();
    expect(screen.getByText('Bitcoin')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const editDialog = await screen.findByRole('dialog', { name: 'Edit Market Calendar Event' });
    await user.selectOptions(within(editDialog).getByLabelText('Recurrence'), 'weekly');
    const linkedEntityField = within(editDialog).getByPlaceholderText('Optional: Bitcoin, ETH, Arbitrum');
    await user.clear(linkedEntityField);
    await user.type(linkedEntityField, 'Eth');
    await user.click(await within(editDialog).findByRole('button', { name: /Ethereum/i }));
    const descriptionField = within(editDialog).getByPlaceholderText(
      'Optional trader-facing context, such as expected impact or asset scope.',
    );
    await user.clear(descriptionField);
    await user.type(descriptionField, 'Now tracked as a weekly macro catalyst.');
    await user.click(within(editDialog).getByRole('button', { name: 'Save Changes' }));

    await screen.findByText('Weekly');
    expect(screen.getByText('Now tracked as a weekly macro catalyst.')).toBeInTheDocument();
    expect(screen.getByText('Ethereum')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(screen.getByText('No upcoming catalysts')).toBeInTheDocument();
    });
  });
});
