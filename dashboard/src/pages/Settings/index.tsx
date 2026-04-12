import { lazy, Suspense, useState } from 'react';
import { useAuth } from '../../components/AuthProvider.js';
import type { Tab } from './types.js';

export type {
  Tab,
  IsoDateTimeString,
  Source,
  PipelineStatus,
  MacroBias,
  MacroSignal,
  MacroIndicator,
  MacroOverviewEntry,
  MacroOverview,
  UnusualActivityEntry,
  UnusualActivityOverview,
  NarrativeSignalStrength,
  NarrativeWatchlistEntry,
  NarrativeWatchlistOverview,
  NarrativeSummaryPreview,
  NarrativeDrilldown,
  HealthCheck,
  HealthResponse,
  DiagBackpressure,
  DiagStuckItemSample,
  DiagStuckItems,
  DiagHaltedSource,
  DiagHaltedSources,
  DiagHealthEvent,
  DiagHealthEvents,
  LlmCostByModelEntry,
  LlmCostByModelResponse,
  Config,
  UserRecord,
  UserAuditEvent,
  AccessRequest,
  SessionInfo,
  DiscordManagedToken,
  DiscordTokenHealthState,
  CalendarEvent,
  EntitySuggestion,
  EntityAliasOrigin,
  EntityAlias,
  EntityRelationshipType,
  EntityRelationshipSource,
  EntityRelationship,
  EntityRelationshipGraphNode,
  EntityRelationshipGraphData,
  EntityDivergence,
  EntityPriceSnapshot,
  EntityPriceData,
  AlphaPropagationSummaryEntry,
  AlphaPropagationRecord,
  AlphaPropagationData,
  AuthorRecord,
  EntityAuthor,
  AuthorClaimType,
  AuthorCall,
  AuthorProfileData,
  EntityRelationshipGraphConnection,
  EntityRelationshipSecondDegreeGroup,
} from './types.js';

const LazySourcesTab = lazy(() => import('./SourcesTab'));
const LazyDeliveryTab = lazy(() => import('./DeliveryTab'));
const LazyPipelineTab = lazy(() => import('./PipelineTab'));
const LazyEntitiesTab = lazy(() => import('./EntitiesTab'));
const LazyUsersTab = lazy(() => import('./UsersTab'));

const eagerTabs =
  import.meta.env.MODE === 'test'
    ? await Promise.all([
        import('./SourcesTab'),
        import('./DeliveryTab'),
        import('./PipelineTab'),
        import('./EntitiesTab'),
        import('./UsersTab'),
      ]).then(([sourcesTab, deliveryTab, pipelineTab, entitiesTab, usersTab]) => ({
        SourcesTab: sourcesTab.default,
        DeliveryTab: deliveryTab.default,
        PipelineTab: pipelineTab.default,
        EntitiesTab: entitiesTab.default,
        UsersTab: usersTab.default,
      }))
    : null;

function SourcesTab() {
  if (eagerTabs != null) {
    return <eagerTabs.SourcesTab />;
  }

  return <LazySourcesTab />;
}

function DeliveryTab() {
  if (eagerTabs != null) {
    return <eagerTabs.DeliveryTab />;
  }

  return <LazyDeliveryTab />;
}

function PipelineTab() {
  if (eagerTabs != null) {
    return <eagerTabs.PipelineTab />;
  }

  return <LazyPipelineTab />;
}

function EntitiesTab() {
  if (eagerTabs != null) {
    return <eagerTabs.EntitiesTab />;
  }

  return <LazyEntitiesTab />;
}

function UsersTab() {
  if (eagerTabs != null) {
    return <eagerTabs.UsersTab />;
  }

  return <LazyUsersTab />;
}

function TabSkeleton() {
  return (
    <div className="p-6 space-y-4">
      <div className="animate-pulse space-y-4">
        <div className="h-4 bg-surface rounded w-1/4" />
        <div className="h-4 bg-surface rounded w-full" />
        <div className="h-4 bg-surface rounded w-3/4" />
        <div className="h-4 bg-surface rounded w-1/2" />
      </div>
    </div>
  );
}

export function Settings() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const tabs: { key: Tab; label: string; adminOnly?: boolean }[] = [
    { key: 'sources', label: 'Sources', adminOnly: true },
    { key: 'delivery', label: 'Delivery', adminOnly: true },
    { key: 'pipeline', label: 'Pipeline' },
    { key: 'entities', label: 'Entities' },
    { key: 'users', label: 'Users', adminOnly: true },
  ];

  const visibleTabs = tabs.filter((tab) => !tab.adminOnly || isAdmin);
  const [activeTab, setActiveTab] = useState<Tab>(visibleTabs[0]?.key ?? 'pipeline');

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="font-heading text-2xl text-text-primary">Settings</h1>
      <div className="flex gap-1 border-b border-border">
        {visibleTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 font-mono text-xs uppercase tracking-wider transition-colors border-b-2 -mb-px ${activeTab === tab.key ? 'border-accent text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === 'sources' && isAdmin && (
        <Suspense fallback={<TabSkeleton />}>
          <SourcesTab />
        </Suspense>
      )}
      {activeTab === 'delivery' && isAdmin && (
        <Suspense fallback={<TabSkeleton />}>
          <DeliveryTab />
        </Suspense>
      )}
      {activeTab === 'pipeline' && (
        <Suspense fallback={<TabSkeleton />}>
          <PipelineTab />
        </Suspense>
      )}
      {activeTab === 'entities' && (
        <Suspense fallback={<TabSkeleton />}>
          <EntitiesTab />
        </Suspense>
      )}
      {activeTab === 'users' && isAdmin && (
        <Suspense fallback={<TabSkeleton />}>
          <UsersTab />
        </Suspense>
      )}
    </div>
  );
}
