import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { EntityLink } from '../components/EntityLink';
import { apiFetch, isApiError } from '../lib/api';
import { formatDateTime, sentimentTextColor } from '../lib/formatting';

interface EntityProfile {
  id: string;
  name: string;
  type: string;
  status: string;
  relevance: number;
  firstSeen: number;
  lastSeen: number;
  mentionCount: number;
  aliases: string[];
}

interface EntityMention {
  id: string;
  summaryId: string | null;
  sentiment: number | null;
  mentionCount: number;
  createdAt: number;
  source: string;
}

interface EntityAuthor {
  id: string;
  platform: string;
  handle: string;
  displayName: string | null;
  firstSeen: number;
  lastSeen: number;
  mentionCount: number;
  createdAt: number;
  entityMentionCount: number;
  firstEntityCallTime: number | null;
  firstMover: boolean;
  firstMoverLagMs: number | null;
}

interface EntityRelationship {
  id: string;
  entityIdA: string;
  entityNameA: string;
  entityIdB: string;
  entityNameB: string;
  relationshipType: string;
  confidence: number;
  source: string;
  summaryId: string | null;
  sinceAt: number | null;
  untilAt: number | null;
  createdAt: number;
  updatedAt: number;
}

function formatSigned(value: number, digits = 2): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function formatRelationshipType(relationshipType: string): string {
  return relationshipType.replaceAll('_', ' ');
}

function formatSourceLabel(source: string): string {
  return source.replaceAll('_', ' ');
}

function formatPlatform(platform: string): string {
  if (platform === 'twitter') return 'Twitter/X';
  if (platform === 'discord') return 'Discord';
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

function formatAuthorHandle(platform: string, handle: string): string {
  return platform === 'twitter' && handle.startsWith('@') === false ? `@${handle}` : handle;
}

function formatFirstMover(author: EntityAuthor): string {
  if (author.firstEntityCallTime == null) return 'No tracked calls';
  if (author.firstMover) return 'First mover';
  if (author.firstMoverLagMs == null) return 'Tracked later';

  const minutes = Math.round(author.firstMoverLagMs / 60000);
  if (minutes < 60) return `+${minutes}m from lead`;

  const hours = author.firstMoverLagMs / (60 * 60 * 1000);
  if (hours < 24) return `+${hours.toFixed(1)}h from lead`;

  const days = author.firstMoverLagMs / (24 * 60 * 60 * 1000);
  return `+${days.toFixed(1)}d from lead`;
}

function getRelatedEntity(relationship: EntityRelationship, entityId: string): { id: string; name: string } {
  if (relationship.entityIdA === entityId) {
    return {
      id: relationship.entityIdB,
      name: relationship.entityNameB,
    };
  }

  return {
    id: relationship.entityIdA,
    name: relationship.entityNameA,
  };
}

export function EntityDetail() {
  const { id } = useParams<{ id: string }>();
  const requestKey = id ?? '';
  const [entity, setEntity] = useState<EntityProfile | null>(null);
  const [mentions, setMentions] = useState<EntityMention[]>([]);
  const [mentionsTotal, setMentionsTotal] = useState(0);
  const [authors, setAuthors] = useState<EntityAuthor[]>([]);
  const [relationships, setRelationships] = useState<EntityRelationship[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      return;
    }

    let cancelled = false;

    Promise.all([
      apiFetch<{ entity: EntityProfile }>(`/entities/${id}`),
      apiFetch<{ mentions: EntityMention[]; total: number }>(`/entities/${id}/mentions?limit=20`),
      apiFetch<{ authors: EntityAuthor[] }>(`/entities/${id}/authors`).catch(() => ({ authors: [] })),
      apiFetch<{ relationships: EntityRelationship[] }>(`/entities/${id}/relationships`).catch(() => ({
        relationships: [],
      })),
    ])
      .then(([profileRes, mentionsRes, authorsRes, relationshipsRes]) => {
        if (cancelled) return;
        setEntity(profileRes.entity);
        setMentions(mentionsRes.mentions);
        setMentionsTotal(mentionsRes.total);
        setAuthors(authorsRes.authors);
        setRelationships(relationshipsRes.relationships);
        setError(null);
        setLoadedKey(id);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setEntity(null);
        setMentions([]);
        setMentionsTotal(0);
        setAuthors([]);
        setRelationships([]);
        if (isApiError(err) && err.status === 404) {
          setError('Entity not found.');
          setLoadedKey(id);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load entity.');
        setLoadedKey(id);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const loading = Boolean(id) && loadedKey !== requestKey;

  if (!id) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-accent-red font-body">Entity not found.</p>
        <Link to="/settings" className="inline-block text-accent hover:underline text-sm font-body">
          &larr; Back to Settings
        </Link>
      </div>
    );
  }

  if (loading) {
    return <div className="p-6 text-text-secondary font-body">Loading...</div>;
  }

  if (error || !entity) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-accent-red font-body">{error ?? 'Entity not found.'}</p>
        <Link to="/settings" className="inline-block text-accent hover:underline text-sm font-body">
          &larr; Back to Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div>
        <Link to="/settings" className="inline-block text-text-secondary hover:text-accent text-xs font-mono mb-4">
          &larr; Settings / Entities
        </Link>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <h1 className="text-2xl font-heading text-text-primary">{entity.name}</h1>
          <span className="px-2 py-0.5 rounded text-xs font-mono uppercase tracking-wider bg-accent/15 text-accent">
            {entity.type}
          </span>
          <span
            className={`px-2 py-0.5 rounded text-xs font-mono uppercase tracking-wider ${
              entity.status === 'active' ? 'bg-accent-green/15 text-accent-green' : 'bg-border/50 text-text-secondary'
            }`}
          >
            {entity.status}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mt-5">
          <div className="bg-surface border border-border rounded-lg p-4">
            <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-2">Mentions</div>
            <div className="text-sm text-text-primary font-body">
              {entity.mentionCount} mention{entity.mentionCount !== 1 ? 's' : ''}
            </div>
          </div>
          <div className="bg-surface border border-border rounded-lg p-4">
            <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-2">Relevance</div>
            <div className="text-sm text-text-primary font-body">{entity.relevance.toFixed(2)}</div>
          </div>
          <div className="bg-surface border border-border rounded-lg p-4">
            <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-2">First Seen</div>
            <div className="text-sm text-text-primary font-body">{formatDateTime(entity.firstSeen)}</div>
          </div>
          <div className="bg-surface border border-border rounded-lg p-4">
            <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-2">Last Seen</div>
            <div className="text-sm text-text-primary font-body">{formatDateTime(entity.lastSeen)}</div>
          </div>
        </div>
      </div>

      {entity.aliases.length > 0 && (
        <div className="bg-surface border border-border rounded-lg p-4">
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary mb-3">Aliases</h2>
          <div className="flex flex-wrap gap-2">
            {entity.aliases.map((alias) => (
              <span key={alias} className="px-2 py-1 rounded-lg bg-surface-raised text-text-primary text-sm font-body">
                {alias}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary">
            Recent Mentions ({mentionsTotal})
          </h2>
        </div>
        {mentions.length === 0 ? (
          <p className="px-4 py-8 text-center text-text-secondary text-sm font-body">
            Entities are discovered automatically from your sources. They'll appear here as reports are generated.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {mentions.map((mention) => (
              <div key={mention.id} className="px-4 py-3 hover:bg-surface-raised transition-colors">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide bg-border/50 text-text-secondary">
                      {mention.source}
                    </span>
                    <span className="text-xs text-text-secondary font-mono">
                      {mention.mentionCount} mention{mention.mentionCount !== 1 ? 's' : ''}
                    </span>
                    {mention.summaryId && (
                      <Link
                        to={`/summaries/${mention.summaryId}`}
                        className="text-accent hover:underline text-xs font-mono"
                      >
                        View summary
                      </Link>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-text-secondary font-mono flex-wrap justify-end">
                    {mention.sentiment != null && (
                      <span className={sentimentTextColor(mention.sentiment)}>{formatSigned(mention.sentiment)}</span>
                    )}
                    <span>{formatDateTime(mention.createdAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary">
            Relationships ({relationships.length})
          </h2>
        </div>
        {relationships.length === 0 ? (
          <p className="px-4 py-8 text-center text-text-secondary text-sm font-body">No relationships recorded yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {relationships.map((relationship) => {
              const relatedEntity = getRelatedEntity(relationship, entity.id);
              return (
                <div key={relationship.id} className="px-4 py-4 flex items-start justify-between gap-4">
                  <div className="space-y-2 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <EntityLink entityId={relatedEntity.id} displayName={relatedEntity.name} />
                      <span className="px-2 py-0.5 rounded bg-border/50 text-text-secondary text-[11px] font-mono uppercase tracking-wide">
                        {formatRelationshipType(relationship.relationshipType)}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-background border border-border text-text-secondary text-[11px] font-mono uppercase tracking-wide">
                        {formatSourceLabel(relationship.source)}
                      </span>
                    </div>
                    <div className="text-xs text-text-secondary font-body">
                      Confidence {relationship.confidence.toFixed(2)} | updated {formatDateTime(relationship.updatedAt)}
                    </div>
                    {(relationship.sinceAt != null || relationship.untilAt != null) && (
                      <div className="text-xs text-text-secondary font-body">
                        {relationship.sinceAt != null
                          ? `Since ${formatDateTime(relationship.sinceAt)}`
                          : 'Start unknown'}
                        {relationship.untilAt != null ? ` | Until ${formatDateTime(relationship.untilAt)}` : ''}
                      </div>
                    )}
                    {relationship.summaryId && (
                      <Link
                        to={`/summaries/${relationship.summaryId}`}
                        className="inline-flex items-center text-xs font-mono uppercase tracking-wide text-accent hover:underline"
                      >
                        Open evidence summary
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary">
            Top Authors ({authors.length})
          </h2>
        </div>
        {authors.length === 0 ? (
          <p className="px-4 py-8 text-center text-text-secondary text-sm font-body">No tracked authors yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {authors.map((author) => {
              const displayHandle = formatAuthorHandle(author.platform, author.handle);
              const primaryName = author.displayName?.trim() || displayHandle;
              return (
                <div key={author.id} className="px-4 py-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm text-text-primary font-body truncate">{primaryName}</div>
                    <div className="mt-1 text-[11px] font-mono uppercase tracking-wide text-text-secondary">
                      {formatPlatform(author.platform)} | {displayHandle}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-mono uppercase tracking-wide">
                      <span className="px-2 py-1 rounded-full bg-background border border-border text-text-secondary">
                        {author.entityMentionCount} entity mention{author.entityMentionCount !== 1 ? 's' : ''}
                      </span>
                      <span className="px-2 py-1 rounded-full bg-background border border-border text-text-secondary">
                        {author.mentionCount} total mention{author.mentionCount !== 1 ? 's' : ''}
                      </span>
                      <span
                        className={`px-2 py-1 rounded-full border ${
                          author.firstEntityCallTime != null && author.firstMover
                            ? 'bg-accent-green/15 border-accent-green/30 text-accent-green'
                            : 'bg-background border-border text-text-secondary'
                        }`}
                      >
                        {formatFirstMover(author)}
                      </span>
                    </div>
                  </div>
                  <div className="text-right text-xs text-text-secondary font-mono shrink-0">
                    <div>Last seen {formatDateTime(author.lastSeen)}</div>
                    <div className="mt-1">
                      {author.firstEntityCallTime != null
                        ? `First call ${formatDateTime(author.firstEntityCallTime)}`
                        : 'No tracked call'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
