import { Fragment, useState, useEffect } from 'react';
import { Link } from 'react-router';
import { apiFetch, isApiError, isFeatureDisabledError } from '../../lib/api.js';
import { useAuth } from '../../components/AuthProvider.js';
import { useStatus } from '../../components/StatusProvider.js';
import { FeatureDisabledCard } from '../../components/FeatureDisabledCard.js';
import { StatusBadge } from '../../components/StatusBadge.js';
import { EmptyState } from '../../components/EmptyState.js';
import { Modal } from '../../components/Modal.js';
import type {
  EntitySuggestion,
  EntityRelationshipGraphData,
  EntityRelationshipGraphConnection,
  Source,
  PipelineStatus,
  DiscordManagedToken,
  DiscordTokenHealthState,
  Config,
  MacroOverview,
  UnusualActivityOverview,
  NarrativeWatchlistOverview,
  NarrativeDrilldown,
  HealthResponse,
  DiagBackpressure,
  DiagStuckItems,
  DiagHaltedSources,
  DiagHealthEvents,
  LlmCostByModelResponse,
  CalendarEvent,
  EntityAlias,
  EntityRelationshipType,
  EntityRelationship,
  EntityDivergence,
  EntityPriceData,
  AlphaPropagationData,
  EntityAuthor,
  AuthorProfileData,
  UserRecord,
  UserAuditEvent,
  AccessRequest,
  SessionInfo,
  Tab,
} from './types.js';
import {
  fetchSourcesData,
  fetchDiscordTokensData,
  fetchDiscordTokenHealthData,
  fetchCalendarEventsData,
  fetchMacroOverviewData,
  fetchDiagBackpressure,
  fetchLlmCostByModel,
  fetchDiagStuckItems,
  fetchDiagHaltedSources,
  fetchDiagHealthEvents,
  fetchUnusualActivityOverviewData,
  fetchNarrativeWatchlistData,
  fetchNarrativeDrilldownData,
  fetchEntitySuggestionsData,
  fetchEntityAliasesData,
  fetchEntityRelationshipsData,
  fetchEntityCompetitorsData,
  fetchEntityRelationshipGraphData,
  fetchEntityDivergenceData,
  fetchEntityPriceData,
  fetchAlphaPropagation,
  fetchEntityAuthorsData,
  fetchAuthorProfileData,
  fetchUsersData,
  fetchUserSessions,
  fetchUserAuditEventsData,
  fetchAccessRequestsData,
  revokeUserSession,
} from './api.js';
import {
  getEntityStatusBadgeClasses,
  formatEntityRelevancePercent,
  buildFallbackEntitySuggestion,
  ENTITY_RELATIONSHIP_GRAPH_STYLES,
  MAX_ENTITY_GRAPH_CONNECTIONS,
  getEntityRelationshipConnectionSummary,
  getEntityRelationshipGraphPosition,
  buildEntityRelationshipSecondDegreeGroups,
  getSourceDisplayName,
  buildSourceActionPath,
  formatRelativeTime,
  decodeTwitterError,
  TIMEZONES,
  macroToneClasses,
  formatMacroValue,
  formatMacroChange,
  formatUnusualActivityRatio,
  formatUnusualActivityRelevance,
  unusualActivityBadgeClasses,
  formatSignedFixed,
  formatUnusualActivityNarrative,
  narrativeSignalClasses,
  formatNarrativeSignalLabel,
  formatNarrativeSentiment,
  formatNarrativeLifecycleCopy,
  CALENDAR_EVENT_CATEGORIES,
  CALENDAR_RECURRENCE_RULES,
  formatCalendarEventTime,
  toDatetimeLocalInputValue,
  defaultCalendarEventInputValue,
  formatCalendarRecurrence,
  formatCompactDuration,
  formatIsoDateTime,
  formatIsoAge,
  truncateDiagnosticText,
  getDiagSeverityClasses,
  isApi404,
  formatCompactNumber,
  ENTITY_RELATIONSHIP_TYPE_OPTIONS,
  ENTITY_RELATIONSHIP_SOURCE_STYLES,
  ENTITY_ALIAS_ORIGIN_STYLES,
  formatDateLabel,
  parseDatetimeLocalInputValue,
  formatEntityRelationshipType,
  formatEntityAliasOrigin,
  formatEntityRelationshipSource,
  formatRelationshipBoundary,
  getRelatedEntityName,
  formatAuthorHandle,
  formatAuthorPlatform,
  formatAuthorClaimType,
  getAuthorClaimTypeStyles,
  formatAuthorTiming,
  buildEntityRelationshipGraphConnections,
  isPendingInvite,
  getAuditTargetLabel,
} from './formatters.js';

export default function UsersTab() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([]);
  const [auditEvents, setAuditEvents] = useState<UserAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteDiscordId, setInviteDiscordId] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRecord['role']>('viewer');
  const [inviteSaving, setInviteSaving] = useState(false);
  const [requestRoleDrafts, setRequestRoleDrafts] = useState<Record<string, 'viewer' | 'admin'>>({});
  const [requestMutatingId, setRequestMutatingId] = useState<string | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [userSessions, setUserSessions] = useState<SessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const reloadUsersAuditAndRequests = async () => {
    const [usersResult, requestsResult, auditResult] = await Promise.allSettled([
      fetchUsersData(),
      fetchAccessRequestsData(),
      fetchUserAuditEventsData(),
    ]);
    if (usersResult.status === 'fulfilled') {
      setUsers(usersResult.value);
      setError(null);
    } else {
      setError('Failed to load users.');
    }
    if (requestsResult.status === 'fulfilled') {
      setAccessRequests(requestsResult.value);
      setRequestsError(null);
      setRequestRoleDrafts((prev) => {
        const next = { ...prev };
        for (const request of requestsResult.value) {
          if (!next[request.id]) next[request.id] = request.requestedRole;
        }
        return next;
      });
    } else {
      setRequestsError('Failed to load access requests.');
    }
    if (auditResult.status === 'fulfilled') {
      setAuditEvents(auditResult.value);
      setAuditError(null);
    } else {
      setAuditError('Failed to load recent activity.');
    }
  };
  useEffect(() => {
    reloadUsersAuditAndRequests().finally(() => setLoading(false));
  }, []);
  const openInviteModal = () => {
    setInviteDiscordId('');
    setInviteRole('viewer');
    setError(null);
    setInviteModalOpen(true);
  };
  const toggleUserSessions = async (discordId: string) => {
    if (expandedUserId === discordId) {
      setExpandedUserId(null);
      setUserSessions([]);
      return;
    }
    setExpandedUserId(discordId);
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const sessions = await fetchUserSessions(discordId);
      setUserSessions(sessions);
    } catch {
      setSessionsError('Failed to load sessions.');
    } finally {
      setSessionsLoading(false);
    }
  };
  const revokeSession = async (discordId: string, managementId: string) => {
    try {
      await revokeUserSession(discordId, managementId);
      setUserSessions((prev) => prev.filter((session) => session.managementId !== managementId));
    } catch {
      setSessionsError('Failed to revoke session.');
    }
  };
  const changeRole = async (discordId: string, role: string) => {
    setError(null);
    try {
      await apiFetch(`/users/${discordId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      await reloadUsersAuditAndRequests();
    } catch {
      setError(`Failed to update role for user.`);
    }
  };
  const inviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedDiscordId = inviteDiscordId.trim();
    if (!trimmedDiscordId) return;
    setInviteSaving(true);
    setError(null);
    try {
      await apiFetch<UserRecord>('/users/invite', {
        method: 'POST',
        body: JSON.stringify({ discordId: trimmedDiscordId, role: inviteRole }),
      });
      await reloadUsersAuditAndRequests();
      setInviteModalOpen(false);
    } catch (err: unknown) {
      if (isApiError(err) && err.status === 400) {
        setError('Discord IDs must be 17-20 digits.');
      } else {
        setError('Failed to invite user.');
      }
    } finally {
      setInviteSaving(false);
    }
  };
  const reviewAccessRequest = async (requestId: string, decision: 'approved' | 'rejected') => {
    setRequestsError(null);
    setRequestMutatingId(requestId);
    try {
      await apiFetch(`/access-requests/${requestId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          decision,
          role: decision === 'approved' ? (requestRoleDrafts[requestId] ?? 'viewer') : undefined,
        }),
      });
      setRequestRoleDrafts((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
      await reloadUsersAuditAndRequests();
    } catch {
      setRequestsError(`Failed to ${decision === 'approved' ? 'approve' : 'reject'} access request.`);
    } finally {
      setRequestMutatingId(null);
    }
  };
  if (loading) return <div className="text-text-secondary font-body py-8">Loading...</div>;
  if (users.length === 0 && error) {
    return <p className="text-red-400 text-sm font-body py-4">{error}</p>;
  }
  const inviteModal = (
    <Modal open={inviteModalOpen} onClose={() => setInviteModalOpen(false)} title="Invite User">
      <form onSubmit={inviteUser} className="space-y-4">
        <div className="space-y-1.5">
          <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Discord ID</label>
          <input
            type="text"
            required
            value={inviteDiscordId}
            onChange={(e) => setInviteDiscordId(e.target.value)}
            placeholder="123456789012345678"
            className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-mono placeholder:text-[#555566] focus:outline-none focus:border-accent"
          />
          <p className="text-xs text-text-secondary/70 font-body">
            Pre-authorize this Discord account before the user signs in for the first time.
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="font-mono text-xs uppercase tracking-wider text-text-secondary">Starting Role</label>
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as UserRecord['role'])}
            className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
          >
            <option value="viewer">viewer</option>
            <option value="admin">admin</option>
            <option value="blocked">blocked</option>
          </select>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => setInviteModalOpen(false)}
            className="px-4 py-2 bg-surface-raised border border-border rounded-lg text-text-secondary text-sm font-body hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={inviteSaving || !inviteDiscordId.trim()}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-body hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {inviteSaving ? 'Inviting...' : 'Invite User'}
          </button>
        </div>
      </form>
    </Modal>
  );
  return (
    <div className="space-y-4">
      {inviteModal}
      {error && <p className="text-red-400 text-sm font-body">{error}</p>}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-text-secondary/70 text-sm font-body">
          Podders is invite-only. Pre-authorize Discord IDs here before first login, then adjust roles as needed.
        </p>
        <button
          onClick={openInviteModal}
          className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-body hover:opacity-90 transition-opacity"
        >
          Invite User
        </button>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-secondary font-mono text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">User</th>
                <th className="text-left px-4 py-3">Role</th>
                <th className="text-left px-4 py-3">Last Login</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <Fragment key={u.discordId}>
                  <tr className="border-b border-border hover:bg-surface-raised transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {u.avatar && !isPendingInvite(u) ? (
                          <img
                            src={`https://cdn.discordapp.com/avatars/${u.discordId}/${u.avatar}.png?size=32`}
                            alt=""
                            className="w-8 h-8 rounded-full"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-surface-raised flex items-center justify-center text-text-secondary text-xs font-mono">
                            {(isPendingInvite(u) ? '?' : u.username.charAt(0)).toUpperCase()}
                          </div>
                        )}
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-text-primary font-body">
                              {isPendingInvite(u) ? 'Pending invite' : u.username}
                            </span>
                            {isPendingInvite(u) && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-border text-text-secondary">
                                waiting for first login
                              </span>
                            )}
                          </div>
                          <div className="text-text-secondary/60 text-xs font-mono">{u.discordId}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-mono ${
                          u.role === 'admin'
                            ? 'bg-accent/20 text-accent'
                            : u.role === 'blocked'
                              ? 'bg-accent-red/20 text-accent-red'
                              : 'bg-border text-text-secondary'
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary font-mono text-xs">
                      {formatRelativeTime(u.lastLoginAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-col items-end gap-2">
                        {u.discordId !== currentUser?.discordId && (
                          <select
                            value={u.role}
                            onChange={(e) => changeRole(u.discordId, e.target.value)}
                            className="bg-background border border-border rounded px-2 py-1 text-text-primary text-xs font-mono focus:outline-none focus:border-accent"
                          >
                            <option value="admin">admin</option>
                            <option value="viewer">viewer</option>
                            <option value="blocked">blocked</option>
                          </select>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleUserSessions(u.discordId)}
                          className="text-[10px] font-mono uppercase tracking-wider text-text-secondary hover:text-accent hover:underline"
                        >
                          {expandedUserId === u.discordId ? 'Hide sessions' : 'Sessions'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedUserId === u.discordId && (
                    <tr className="border-b border-border bg-surface-raised/30">
                      <td colSpan={4} className="px-4 pb-3">
                        <div className="mt-2 pl-4 border-l border-border space-y-2">
                          {sessionsLoading && <p className="text-xs text-text-secondary">Loading sessions...</p>}
                          {sessionsError && <p className="text-xs text-accent-red">{sessionsError}</p>}
                          {!sessionsLoading && !sessionsError && userSessions.length === 0 && (
                            <p className="text-xs text-text-secondary">No active sessions</p>
                          )}
                          {userSessions.map((session) => (
                            <div key={session.managementId} className="flex items-center justify-between gap-4 text-xs">
                              <div className="space-y-0.5">
                                <div className="font-mono text-text-primary">
                                  {session.normalizedUA ?? 'unknown device'}
                                </div>
                                <div className="text-text-secondary">
                                  {session.ipAddress ?? 'unknown IP'} · last active{' '}
                                  {formatRelativeTime(session.lastRefreshedAt)}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => revokeSession(u.discordId, session.managementId)}
                                className="text-[10px] font-mono uppercase tracking-wider text-accent-red hover:underline"
                              >
                                Revoke
                              </button>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-4">
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">
                Pending Access Requests
              </h3>
              <p className="text-text-secondary/70 mt-1 text-sm font-body">
                Review self-service access requests from the login page.
              </p>
            </div>
            {requestsError && <p className="px-4 py-3 text-red-400 text-sm font-body">{requestsError}</p>}
            {!requestsError && accessRequests.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-text-secondary text-sm font-body">No pending access requests.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {accessRequests.map((request) => (
                  <div key={request.id} className="px-4 py-3 space-y-3">
                    <div className="space-y-1">
                      <div className="text-text-primary text-sm font-body">{request.discordId}</div>
                      <div className="flex items-center justify-between gap-3 text-xs font-mono">
                        <span className="text-text-secondary">requested {request.requestedRole}</span>
                        <span className="text-text-secondary">{formatRelativeTime(request.createdAt)}</span>
                      </div>
                    </div>
                    {request.note && <p className="text-text-secondary text-sm font-body">{request.note}</p>}
                    <div className="flex items-center gap-2 flex-wrap">
                      <select
                        value={requestRoleDrafts[request.id] ?? request.requestedRole}
                        onChange={(e) =>
                          setRequestRoleDrafts((prev) => ({
                            ...prev,
                            [request.id]: e.target.value as 'viewer' | 'admin',
                          }))
                        }
                        className="bg-background border border-border rounded px-2 py-1 text-text-primary text-xs font-mono focus:outline-none focus:border-accent"
                      >
                        <option value="viewer">viewer</option>
                        <option value="admin">admin</option>
                      </select>
                      <button
                        onClick={() => reviewAccessRequest(request.id, 'approved')}
                        disabled={requestMutatingId === request.id}
                        className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-body hover:opacity-90 transition-opacity disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => reviewAccessRequest(request.id, 'rejected')}
                        disabled={requestMutatingId === request.id}
                        className="px-3 py-1.5 bg-accent-red/20 text-accent-red border border-accent-red/30 rounded-lg text-xs font-body hover:bg-accent-red/30 transition-colors disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-mono text-xs uppercase tracking-wider text-text-secondary">Recent Access Activity</h3>
              <p className="text-text-secondary/70 mt-1 text-sm font-body">
                Invites, request decisions, and role changes made by admins, newest first.
              </p>
            </div>
            {auditError && <p className="px-4 py-3 text-red-400 text-sm font-body">{auditError}</p>}
            {!auditError && auditEvents.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-text-secondary text-sm font-body">No recent user-management activity.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {auditEvents.map((event) => {
                  const targetLabel = getAuditTargetLabel(event);
                  let title = `Updated ${targetLabel}`;
                  let detail = `${event.previousRole ?? 'unknown'} -> ${event.newRole ?? 'unknown'}`;
                  let badge = 'role change';
                  if (event.action === 'invite') {
                    title = `Invited ${targetLabel}`;
                    detail = `Role ${event.newRole ?? 'viewer'}`;
                    badge = 'invite';
                  } else if (event.action === 'request_approved') {
                    title = `Approved request for ${targetLabel}`;
                    detail = `${event.previousRole ?? 'no access'} -> ${event.newRole ?? 'unknown'}`;
                    badge = 'request approved';
                  } else if (event.action === 'request_rejected') {
                    title = `Rejected request for ${targetLabel}`;
                    detail = event.previousRole ? `Current role ${event.previousRole}` : 'No access granted';
                    badge = 'request rejected';
                  } else if (event.action === 'role_change') {
                    title = `Changed ${targetLabel} to ${event.newRole ?? 'unknown'}`;
                    detail = `${event.previousRole ?? 'unknown'} -> ${event.newRole ?? 'unknown'}`;
                  }
                  return (
                    <div key={event.id} className="px-4 py-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="text-text-primary text-sm font-body">{title}</div>
                          <div className="text-text-secondary/60 text-xs font-mono">{event.targetDiscordId}</div>
                        </div>
                        <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-border text-text-secondary">
                          {badge}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-xs font-mono">
                        <span className="text-text-secondary">{detail}</span>
                        <span className="text-text-secondary">{formatRelativeTime(event.createdAt)}</span>
                      </div>
                      <div className="text-text-secondary/60 text-xs font-body">by {event.actorUsername}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
