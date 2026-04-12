import type {
  Source,
  SourceActivityBucket,
  SourceActivityResponse,
  DiscordManagedToken,
  DiscordTokenHealthState,
  UserRecord,
  UserAuditEvent,
  AccessRequest,
  CalendarEvent,
  MacroOverview,
  DiagBackpressure,
  LlmCostByModelResponse,
  DiagStuckItems,
  DiagHaltedSources,
  DiagHealthEvents,
  UnusualActivityOverview,
  NarrativeWatchlistOverview,
  NarrativeDrilldown,
  EntitySuggestion,
  EntityAlias,
  EntityRelationship,
  EntityRelationshipGraphData,
  EntityDivergence,
  EntityPriceData,
  AlphaPropagationData,
  EntityAuthor,
  AuthorProfileData,
  SessionInfo,
  FeedbackItem,
} from './types.js';
import { apiFetch, isApiError } from '../../lib/api.js';

export async function fetchSourcesData(): Promise<Source[]> {
  const res = await apiFetch<{ sources: Source[] }>('/sources');
  return res.sources;
}

export async function fetchSourceActivity(source: string, sourceId: string): Promise<SourceActivityBucket[]> {
  const res = await apiFetch<SourceActivityResponse>(
    `/sources/${encodeURIComponent(source)}/${encodeURIComponent(sourceId)}/activity`,
  );
  return res.buckets;
}

export async function fetchDiscordTokensData(): Promise<DiscordManagedToken[]> {
  const res = await apiFetch<{ tokens: DiscordManagedToken[] }>('/discord/tokens');
  return res.tokens;
}

export async function fetchDiscordTokenHealthData(): Promise<DiscordTokenHealthState[]> {
  const res = await apiFetch<{ states: DiscordTokenHealthState[] }>('/discord/tokens/health');
  return res.states;
}

export async function fetchUsersData(): Promise<UserRecord[]> {
  const res = await apiFetch<{ users: UserRecord[] }>('/users');
  return res.users;
}

export async function fetchUserSessions(discordId: string): Promise<SessionInfo[]> {
  const res = await apiFetch<{ sessions: SessionInfo[] }>(`/users/${discordId}/sessions`);
  return res.sessions;
}

export async function revokeUserSession(discordId: string, managementId: string): Promise<void> {
  await apiFetch(`/users/${discordId}/sessions/${managementId}`, { method: 'DELETE' });
}

export async function fetchUserAuditEventsData(): Promise<UserAuditEvent[]> {
  const res = await apiFetch<{ events: UserAuditEvent[] }>('/users/audit');
  return res.events;
}

export async function fetchAccessRequestsData(): Promise<AccessRequest[]> {
  const res = await apiFetch<{ requests: AccessRequest[] }>('/access-requests');
  return res.requests;
}

export async function fetchCalendarEventsData(): Promise<CalendarEvent[]> {
  const res = await apiFetch<{ events: CalendarEvent[] }>('/calendar-events');
  return res.events;
}

export async function fetchMacroOverviewData(): Promise<MacroOverview | null> {
  try {
    return await apiFetch<MacroOverview>('/macro');
  } catch (err: unknown) {
    if (isApiError(err) && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export async function fetchDiagBackpressure(): Promise<DiagBackpressure> {
  return apiFetch<DiagBackpressure>('/diag/backpressure');
}

export async function fetchLlmCostByModel(): Promise<LlmCostByModelResponse> {
  return apiFetch<LlmCostByModelResponse>('/llm/cost-by-model');
}

export async function fetchDiagStuckItems(): Promise<DiagStuckItems> {
  return apiFetch<DiagStuckItems>('/diag/stuck-items');
}

export async function fetchDiagHaltedSources(): Promise<DiagHaltedSources> {
  return apiFetch<DiagHaltedSources>('/diag/halted-sources');
}

export async function fetchDiagHealthEvents(limit = 10): Promise<DiagHealthEvents> {
  return apiFetch<DiagHealthEvents>(`/diag/health-events?limit=${limit}`);
}

export async function fetchUnusualActivityOverviewData(): Promise<UnusualActivityOverview> {
  return apiFetch<UnusualActivityOverview>('/unusual-activity');
}

export async function fetchNarrativeWatchlistData(): Promise<NarrativeWatchlistOverview> {
  return apiFetch<NarrativeWatchlistOverview>('/narratives');
}

export async function fetchNarrativeDrilldownData(narrativeId: string): Promise<NarrativeDrilldown> {
  const res = await apiFetch<{ narrative: NarrativeDrilldown }>(`/narratives/${narrativeId}`);
  return res.narrative;
}

export async function fetchEntitySuggestionsData(
  query: string,
  statusFilter: 'active' | 'archived' | null = null,
): Promise<EntitySuggestion[]> {
  const params = new URLSearchParams({
    q: query,
    limit: '6',
  });
  if (statusFilter != null) {
    params.set('status', statusFilter);
  }

  const res = await apiFetch<{ entities: EntitySuggestion[] }>(`/entities/search?${params.toString()}`);
  return res.entities;
}

export async function fetchEntityAliasesData(entityId: string): Promise<EntityAlias[]> {
  const res = await apiFetch<{ aliases: EntityAlias[] }>(`/entities/${entityId}/aliases`);
  return res.aliases;
}

export async function fetchEntityRelationshipsData(entityId: string): Promise<EntityRelationship[]> {
  const res = await apiFetch<{ relationships: EntityRelationship[] }>(`/entities/${entityId}/relationships`);
  return res.relationships;
}

export async function fetchEntityCompetitorsData(entityId: string): Promise<EntityRelationship[]> {
  const res = await apiFetch<{ competitors: EntityRelationship[] }>(`/entities/${entityId}/competitors`);
  return res.competitors;
}

export async function fetchEntityRelationshipGraphData(entityId: string): Promise<EntityRelationshipGraphData> {
  return apiFetch<EntityRelationshipGraphData>(`/entities/${entityId}/graph?depth=2&limit=18`);
}

export async function fetchEntityDivergenceData(entityId: string, days: number): Promise<EntityDivergence> {
  const res = await apiFetch<{ divergence: EntityDivergence }>(`/entities/${entityId}/divergence?days=${days}`);
  return res.divergence;
}

export async function fetchEntityPriceData(entityId: string, days: number): Promise<EntityPriceData> {
  return apiFetch<EntityPriceData>(`/entities/${entityId}/price?days=${days}`);
}

export async function fetchAlphaPropagation(entityId: string, days: number): Promise<AlphaPropagationData | null> {
  try {
    const res = await apiFetch<AlphaPropagationData>(`/entities/${entityId}/alpha?days=${days}`);
    return res;
  } catch {
    return null;
  }
}

export async function fetchEntityAuthorsData(entityId: string): Promise<EntityAuthor[]> {
  const res = await apiFetch<{ authors: EntityAuthor[] }>(`/entities/${entityId}/authors?limit=12`);
  return res.authors;
}

export async function fetchAuthorProfileData(authorId: string): Promise<AuthorProfileData> {
  return apiFetch<AuthorProfileData>(`/authors/${authorId}?callLimit=20`);
}

export async function fetchFeedbackList(status?: string): Promise<{ feedback: FeedbackItem[]; total: number }> {
  const params = status ? `?status=${status}` : '';
  return apiFetch(`/feedback${params}`);
}

export async function updateFeedbackStatus(id: string, status: string): Promise<void> {
  await apiFetch(`/feedback/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}
