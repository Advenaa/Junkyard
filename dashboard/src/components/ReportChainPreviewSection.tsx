import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { apiFetch } from '../lib/api';
import type { ReportChainDrilldown } from '../lib/types';
import {
  buildLeadReportHref,
  buildLeadChainHref,
  buildLeadChainLabel,
  buildSummaryChainHref,
  getReportChainRefreshAction,
  getReportChainToggleAction,
  type ReportChainRefreshAction,
  type ReportChainToggleAction,
} from '../lib/reportChains';

interface ReportChainPreviewSectionProps {
  reportId: string;
  chainDrilldowns: ReportChainDrilldown[];
  hiddenActiveChainCount?: number;
  previewSummary?: string;
  previewBody?: string;
  onFocusedReportHrefChange?: (href: string | null) => void;
  onPreviewBodyChange?: (body: string | null) => void;
  onLeadChainLabelChange?: (label: string | null) => void;
  onLeadChainHrefChange?: (href: string | null) => void;
  onVisibleChainCountChange?: (count: number) => void;
  onHeaderStoryActionChange?: (action: ReportChainToggleAction) => void;
  onHeaderRefreshActionChange?: (action: ReportChainRefreshAction) => void;
  toggleVisibleChainsRequest?: number;
  refreshVisibleChainsRequest?: number;
}

interface ReportChainResponse {
  report: {
    eventChains?: string[];
    chainDrilldowns?: ReportChainDrilldown[];
    tldr?: string | null;
    body?: string | null;
  };
}

interface CachedExpandedChains {
  previewRootIds: string[];
  previewSummary?: string;
  previewBody?: string;
  expandedChains: ReportChainDrilldown[];
}

function getStorageKey(reportId: string): string {
  return `podders:report-chain-preview:${reportId}`;
}

function getChainRootIds(chains: ReportChainDrilldown[]): string[] {
  return chains.map((chain) => chain.rootId);
}

function areRootIdsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((rootId, index) => rootId === right[index]);
}

function isLegacyCacheCompatible(cachedChains: ReportChainDrilldown[], previewRootIds: string[]): boolean {
  return previewRootIds.every((rootId, index) => cachedChains[index]?.rootId === rootId);
}

function buildChainPreviewSummary(chain: ReportChainDrilldown | undefined, fallback?: string): string | null {
  if (fallback) return fallback;
  if (!chain) return null;
  return `${chain.entityName} ${chain.latestEventType} chain: ${chain.latestEventDescription}`;
}

function buildPreviewBody(
  tldr: string | null | undefined,
  body: string | null | undefined,
  fallback?: string,
): string | null {
  const candidate =
    typeof tldr === 'string' && tldr.trim().length > 0
      ? tldr
      : typeof body === 'string' && body.trim().length > 0
        ? body
        : fallback;
  if (!candidate) return null;
  return candidate.trim().replace(/\s+/g, ' ');
}

function loadCachedExpandedChains(
  reportId: string,
  chainDrilldowns: ReportChainDrilldown[],
  hiddenActiveChainCount: number,
): CachedExpandedChains | null {
  try {
    const raw = window.sessionStorage.getItem(getStorageKey(reportId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const previewRootIds = getChainRootIds(chainDrilldowns);
    const maxVisibleChainCount = chainDrilldowns.length + hiddenActiveChainCount;

    let cachedPreviewRootIds: string[] | null = null;
    let cachedChains: ReportChainDrilldown[] | null = null;

    if (Array.isArray(parsed)) {
      cachedChains = parsed as ReportChainDrilldown[];
    } else if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray(parsed.previewRootIds) &&
      Array.isArray(parsed.expandedChains)
    ) {
      cachedPreviewRootIds = parsed.previewRootIds as string[];
      cachedChains = parsed.expandedChains as ReportChainDrilldown[];
    }

    if (!Array.isArray(cachedChains)) return null;

    const isExpandedCache = cachedChains.length > chainDrilldowns.length;
    const fitsCurrentVisibleCount = cachedChains.length <= maxVisibleChainCount;
    const matchesCurrentPreview = cachedPreviewRootIds
      ? areRootIdsEqual(cachedPreviewRootIds, previewRootIds)
      : isLegacyCacheCompatible(cachedChains, previewRootIds);

    if (isExpandedCache && fitsCurrentVisibleCount && matchesCurrentPreview) {
      return {
        previewRootIds: cachedPreviewRootIds ?? previewRootIds,
        previewSummary:
          parsed && typeof parsed === 'object' && typeof parsed.previewSummary === 'string'
            ? parsed.previewSummary
            : undefined,
        previewBody:
          parsed && typeof parsed === 'object' && typeof parsed.previewBody === 'string'
            ? parsed.previewBody
            : undefined,
        expandedChains: cachedChains,
      };
    }

    clearCachedExpandedChains(reportId);
    return null;
  } catch {
    return null;
  }
}

function saveCachedExpandedChains(
  reportId: string,
  previewChains: ReportChainDrilldown[],
  expandedChains: ReportChainDrilldown[],
  previewSummary?: string,
  previewBody?: string,
): void {
  try {
    const cachedValue: CachedExpandedChains = {
      previewRootIds: getChainRootIds(previewChains),
      previewSummary,
      previewBody,
      expandedChains,
    };
    window.sessionStorage.setItem(getStorageKey(reportId), JSON.stringify(cachedValue));
  } catch {
    // Ignore storage failures so preview expansion still works in-memory.
  }
}

function clearCachedExpandedChains(reportId: string): void {
  try {
    window.sessionStorage.removeItem(getStorageKey(reportId));
  } catch {
    // Ignore storage failures so preview collapsing still works in-memory.
  }
}

function formatChainCount(count: number): string {
  return `${count} linked event${count !== 1 ? 's' : ''}`;
}

function getChainPreviewLabel(chain: ReportChainDrilldown): string {
  return `${chain.entityName} · ${chain.latestEventType} · ${formatChainCount(chain.eventCount)}`;
}

function getHiddenChainsLabel(hiddenCount: number): string {
  return `${hiddenCount} more active chain${hiddenCount !== 1 ? 's' : ''}`;
}

export function ReportChainPreviewSection({
  reportId,
  chainDrilldowns,
  hiddenActiveChainCount = 0,
  previewSummary,
  previewBody,
  onFocusedReportHrefChange,
  onPreviewBodyChange,
  onLeadChainLabelChange,
  onLeadChainHrefChange,
  onVisibleChainCountChange,
  onHeaderStoryActionChange,
  onHeaderRefreshActionChange,
  toggleVisibleChainsRequest,
  refreshVisibleChainsRequest,
}: ReportChainPreviewSectionProps) {
  const [visibleChains, setVisibleChains] = useState(chainDrilldowns);
  const [currentPreviewSummary, setCurrentPreviewSummary] = useState<string | null>(
    buildChainPreviewSummary(chainDrilldowns[0], previewSummary),
  );
  const [currentPreviewBody, setCurrentPreviewBody] = useState<string | null>(
    buildPreviewBody(null, null, previewBody),
  );
  const [remainingHiddenCount, setRemainingHiddenCount] = useState(hiddenActiveChainCount);
  const [loadingChains, setLoadingChains] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorMode, setLoadErrorMode] = useState<'expand' | 'refresh' | null>(null);
  const handledToggleRequestRef = useRef<number | undefined>(undefined);
  const handledRefreshRequestRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const cachedState = loadCachedExpandedChains(reportId, chainDrilldowns, hiddenActiveChainCount);
    const cachedChains = cachedState?.expandedChains ?? null;
    const canReuseCachedChains = Array.isArray(cachedChains);
    const cachedOverflowCount = canReuseCachedChains ? cachedChains.length - chainDrilldowns.length : 0;
    setVisibleChains(canReuseCachedChains ? cachedChains : chainDrilldowns);
    setCurrentPreviewSummary(
      canReuseCachedChains
        ? buildChainPreviewSummary(cachedChains[0], cachedState?.previewSummary)
        : buildChainPreviewSummary(chainDrilldowns[0], previewSummary),
    );
    setCurrentPreviewBody(
      canReuseCachedChains
        ? buildPreviewBody(null, null, cachedState?.previewBody)
        : buildPreviewBody(null, null, previewBody),
    );
    setRemainingHiddenCount(
      canReuseCachedChains ? Math.max(0, hiddenActiveChainCount - cachedOverflowCount) : hiddenActiveChainCount,
    );
    setLoadingChains(false);
    setLoadError(null);
    setLoadErrorMode(null);
  }, [chainDrilldowns, hiddenActiveChainCount, previewBody, previewSummary, reportId]);

  useEffect(() => {
    onPreviewBodyChange?.(currentPreviewBody);
  }, [currentPreviewBody, onPreviewBodyChange]);

  useEffect(() => {
    onLeadChainLabelChange?.(buildLeadChainLabel(visibleChains[0]));
  }, [onLeadChainLabelChange, visibleChains]);

  useEffect(() => {
    onLeadChainHrefChange?.(buildLeadChainHref(visibleChains[0]));
  }, [onLeadChainHrefChange, visibleChains]);

  useEffect(() => {
    onFocusedReportHrefChange?.(buildLeadReportHref(reportId, visibleChains[0]));
  }, [onFocusedReportHrefChange, reportId, visibleChains]);

  useEffect(() => {
    onVisibleChainCountChange?.(visibleChains.length);
  }, [onVisibleChainCountChange, visibleChains]);

  const headerStoryAction = getReportChainToggleAction({
    previewChainCount: chainDrilldowns.length,
    visibleChainCount: visibleChains.length,
    hiddenActiveChainCount: remainingHiddenCount,
    loading: loadingChains,
    retry: loadErrorMode === 'expand',
  });

  const headerRefreshAction = getReportChainRefreshAction({
    previewChainCount: chainDrilldowns.length,
    visibleChainCount: visibleChains.length,
    hiddenActiveChainCount: remainingHiddenCount,
    loading: loadingChains,
    retry: loadErrorMode === 'refresh',
  });

  useEffect(() => {
    onHeaderStoryActionChange?.(headerStoryAction);
  }, [
    headerStoryAction.controlLabel,
    headerStoryAction.disabled,
    headerStoryAction.mode,
    headerStoryAction.preferActionLabel,
    onHeaderStoryActionChange,
  ]);

  useEffect(() => {
    onHeaderRefreshActionChange?.(headerRefreshAction);
  }, [
    headerRefreshAction.controlLabel,
    headerRefreshAction.disabled,
    headerRefreshAction.visible,
    onHeaderRefreshActionChange,
  ]);

  const loadExpandedChains = async (mode: 'expand' | 'refresh', errorMessage: string) => {
    if (loadingChains) return;

    setLoadingChains(true);
    setLoadError(null);
    setLoadErrorMode(null);

    try {
      const res = await apiFetch<ReportChainResponse>(`/reports/${reportId}`);
      const expandedChains = res.report.chainDrilldowns ?? chainDrilldowns;
      const nextPreviewSummary = buildChainPreviewSummary(expandedChains[0], res.report.eventChains?.[0]);
      const nextPreviewBody = buildPreviewBody(res.report.tldr, res.report.body, previewBody);
      saveCachedExpandedChains(
        reportId,
        chainDrilldowns,
        expandedChains,
        nextPreviewSummary ?? undefined,
        nextPreviewBody ?? undefined,
      );
      setVisibleChains(expandedChains);
      setCurrentPreviewSummary(nextPreviewSummary);
      setCurrentPreviewBody(nextPreviewBody);
      setRemainingHiddenCount(Math.max(0, hiddenActiveChainCount - (expandedChains.length - chainDrilldowns.length)));
      setLoadErrorMode(null);
    } catch {
      setLoadError(errorMessage);
      setLoadErrorMode(mode);
    } finally {
      setLoadingChains(false);
    }
  };

  const showMoreChains = () => loadExpandedChains('expand', 'Failed to load more active chains.');

  const refreshChains = () => loadExpandedChains('refresh', 'Failed to refresh active chains.');

  const showFewerChains = () => {
    clearCachedExpandedChains(reportId);
    setVisibleChains(chainDrilldowns);
    setCurrentPreviewSummary(buildChainPreviewSummary(chainDrilldowns[0], previewSummary));
    setCurrentPreviewBody(buildPreviewBody(null, null, previewBody));
    setRemainingHiddenCount(hiddenActiveChainCount);
    setLoadingChains(false);
    setLoadError(null);
    setLoadErrorMode(null);
  };

  const canCollapseChains = visibleChains.length > chainDrilldowns.length;
  const canRefreshChains = canCollapseChains && remainingHiddenCount === 0;
  const focusedReportHref = buildLeadReportHref(reportId, visibleChains[0]);

  useEffect(() => {
    if (!toggleVisibleChainsRequest) return;
    if (toggleVisibleChainsRequest === handledToggleRequestRef.current) return;
    if (loadingChains) return;

    handledToggleRequestRef.current = toggleVisibleChainsRequest;

    if (headerStoryAction.mode === 'collapse') {
      showFewerChains();
      return;
    }

    if (headerStoryAction.mode === 'expand') {
      void showMoreChains();
    }
  }, [headerStoryAction.mode, loadingChains, toggleVisibleChainsRequest]);

  useEffect(() => {
    if (!refreshVisibleChainsRequest) return;
    if (refreshVisibleChainsRequest === handledRefreshRequestRef.current) return;
    if (loadingChains) return;
    if (!headerRefreshAction.visible) return;

    handledRefreshRequestRef.current = refreshVisibleChainsRequest;
    void refreshChains();
  }, [headerRefreshAction.visible, loadingChains, refreshVisibleChainsRequest]);

  return (
    <div className="border-t border-border px-4 py-3 space-y-2">
      {currentPreviewSummary && (
        <p className="text-xs font-body text-text-secondary leading-relaxed">
          <span className="font-mono uppercase tracking-wider text-[10px] text-text-secondary/80">Event Chain</span>{' '}
          {currentPreviewSummary}
        </p>
      )}
      <div className="text-[10px] font-mono uppercase tracking-wider text-text-secondary">
        {visibleChains.length === 1 ? 'Active chain' : `Active chains | ${visibleChains.length} stories`}
      </div>
      {focusedReportHref && (
        <Link
          to={focusedReportHref}
          className="inline-flex text-[10px] font-mono uppercase tracking-wider text-text-secondary hover:text-accent hover:underline"
        >
          Open focused report
        </Link>
      )}
      <div className="flex flex-wrap gap-2">
        {visibleChains.map((chain) => (
          <Link
            key={chain.rootId}
            to={buildSummaryChainHref(chain.latestSummaryId, chain.rootId)}
            className="rounded-full border border-border px-3 py-1 text-xs font-mono tracking-wider text-accent hover:border-accent/50 hover:underline"
          >
            {getChainPreviewLabel(chain)}
          </Link>
        ))}
      </div>
      {remainingHiddenCount > 0 && (
        <button
          type="button"
          onClick={showMoreChains}
          disabled={loadingChains}
          className="inline-flex text-[10px] font-mono uppercase tracking-wider text-text-secondary hover:text-accent hover:underline disabled:opacity-60"
        >
          {loadingChains
            ? `Loading ${getHiddenChainsLabel(remainingHiddenCount)}...`
            : `Show ${getHiddenChainsLabel(remainingHiddenCount)}`}
        </button>
      )}
      {canCollapseChains && (
        <button
          type="button"
          onClick={showFewerChains}
          className="inline-flex text-[10px] font-mono uppercase tracking-wider text-text-secondary hover:text-accent hover:underline"
        >
          Show fewer chains
        </button>
      )}
      {canRefreshChains && (
        <button
          type="button"
          onClick={refreshChains}
          disabled={loadingChains}
          className="inline-flex text-[10px] font-mono uppercase tracking-wider text-text-secondary hover:text-accent hover:underline disabled:opacity-60"
        >
          {loadingChains ? 'Refreshing active chains...' : 'Refresh chains'}
        </button>
      )}
      {loadError && (
        <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono uppercase tracking-wider text-accent-red">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={canRefreshChains ? refreshChains : showMoreChains}
            className="hover:underline"
            disabled={loadingChains}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
