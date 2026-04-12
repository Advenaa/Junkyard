import { useEffect, useRef, useState } from 'react';
import { apiFetch } from './api';
import {
  buildLeadChainHref,
  buildLeadChainLabel,
  buildLeadReportHref,
  getReportChainRefreshAction,
  getReportChainToggleAction,
  type ReportChainRefreshAction,
  type ReportChainToggleAction,
} from './reportChains';
import type { ReportChainDrilldown } from './types';

export interface UseChainPreviewOptions {
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

export interface ReportChainResponse {
  report: {
    eventChains?: string[];
    chainDrilldowns?: ReportChainDrilldown[];
    tldr?: string | null;
    body?: string | null;
  };
}

export interface CachedExpandedChains {
  previewRootIds: string[];
  previewSummary?: string;
  previewBody?: string;
  expandedChains: ReportChainDrilldown[];
}

export interface UseChainPreviewReturn {
  visibleChains: ReportChainDrilldown[];
  currentPreviewSummary: string | null;
  focusedReportHref: string | null;
  remainingHiddenCount: number;
  loadingChains: boolean;
  loadError: string | null;
  canCollapseChains: boolean;
  canRefreshChains: boolean;
  showMoreChains: () => Promise<void>;
  refreshChains: () => Promise<void>;
  showFewerChains: () => void;
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

export function formatChainCount(count: number): string {
  return `${count} linked event${count !== 1 ? 's' : ''}`;
}

export function getChainPreviewLabel(chain: ReportChainDrilldown): string {
  return `${chain.entityName} · ${chain.latestEventType} · ${formatChainCount(chain.eventCount)}`;
}

export function getHiddenChainsLabel(hiddenCount: number): string {
  return `${hiddenCount} more active chain${hiddenCount !== 1 ? 's' : ''}`;
}

export function useChainPreview({
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
}: UseChainPreviewOptions): UseChainPreviewReturn {
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

  const canCollapseChains = visibleChains.length > chainDrilldowns.length;
  const canRefreshChains = canCollapseChains && remainingHiddenCount === 0;
  const focusedReportHref = buildLeadReportHref(reportId, visibleChains[0]);
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
    onPreviewBodyChange?.(currentPreviewBody);
  }, [currentPreviewBody, onPreviewBodyChange]);

  useEffect(() => {
    onLeadChainLabelChange?.(buildLeadChainLabel(visibleChains[0]));
  }, [onLeadChainLabelChange, visibleChains]);

  useEffect(() => {
    onLeadChainHrefChange?.(buildLeadChainHref(visibleChains[0]));
  }, [onLeadChainHrefChange, visibleChains]);

  useEffect(() => {
    onFocusedReportHrefChange?.(focusedReportHref);
  }, [focusedReportHref, onFocusedReportHrefChange]);

  useEffect(() => {
    onVisibleChainCountChange?.(visibleChains.length);
  }, [onVisibleChainCountChange, visibleChains]);

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
  }, [headerStoryAction.mode, loadingChains, showMoreChains, showFewerChains, toggleVisibleChainsRequest]);

  useEffect(() => {
    if (!refreshVisibleChainsRequest) return;
    if (refreshVisibleChainsRequest === handledRefreshRequestRef.current) return;
    if (loadingChains) return;
    if (!headerRefreshAction.visible) return;

    handledRefreshRequestRef.current = refreshVisibleChainsRequest;
    void refreshChains();
  }, [headerRefreshAction.visible, loadingChains, refreshChains, refreshVisibleChainsRequest]);

  return {
    visibleChains,
    currentPreviewSummary,
    focusedReportHref,
    remainingHiddenCount,
    loadingChains,
    loadError,
    canCollapseChains,
    canRefreshChains,
    showMoreChains,
    refreshChains,
    showFewerChains,
  };
}
