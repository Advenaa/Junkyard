import type { ReportChainDrilldown } from './types';

export interface ReportChainToggleAction {
  mode: 'expand' | 'collapse' | 'none';
  controlLabel: string | null;
  disabled: boolean;
  preferActionLabel?: boolean;
}

export interface ReportChainRefreshAction {
  visible: boolean;
  controlLabel: string | null;
  disabled: boolean;
}

export function buildSummaryChainHref(summaryId: string, chainRootId: string): string {
  const params = new URLSearchParams({ chain: chainRootId });
  return `/summaries/${summaryId}?${params.toString()}`;
}

export function buildFocusedReportHref(reportId: string, chainRootId: string): string {
  const params = new URLSearchParams({ chain: chainRootId });
  return `/reports/${reportId}?${params.toString()}`;
}

export function buildLeadChainLabel(chain: ReportChainDrilldown | null | undefined): string | null {
  if (!chain) return null;
  return `${chain.entityName} · ${chain.latestEventType}`;
}

export function buildLeadChainHref(chain: ReportChainDrilldown | null | undefined): string | null {
  if (!chain) return null;
  return buildSummaryChainHref(chain.latestSummaryId, chain.rootId);
}

export function buildLeadReportHref(reportId: string, chain: ReportChainDrilldown | null | undefined): string | null {
  if (!chain) return null;
  return buildFocusedReportHref(reportId, chain.rootId);
}

export function getReportChainToggleAction({
  previewChainCount,
  visibleChainCount,
  hiddenActiveChainCount,
  loading = false,
  retry = false,
}: {
  previewChainCount: number;
  visibleChainCount: number;
  hiddenActiveChainCount: number;
  loading?: boolean;
  retry?: boolean;
}): ReportChainToggleAction {
  if (visibleChainCount > previewChainCount) {
    return {
      mode: 'collapse',
      controlLabel: 'Show fewer chains',
      disabled: loading,
    };
  }

  if (hiddenActiveChainCount > 0) {
    if (loading) {
      return {
        mode: 'expand',
        controlLabel: 'Loading stories...',
        disabled: true,
        preferActionLabel: true,
      };
    }

    if (retry) {
      return {
        mode: 'expand',
        controlLabel: 'Retry loading stories',
        disabled: false,
        preferActionLabel: true,
      };
    }

    return {
      mode: 'expand',
      controlLabel: `Show ${hiddenActiveChainCount} more active chain${hiddenActiveChainCount !== 1 ? 's' : ''}`,
      disabled: loading,
    };
  }

  return {
    mode: 'none',
    controlLabel: null,
    disabled: false,
  };
}

export function areReportChainToggleActionsEqual(
  left: ReportChainToggleAction,
  right: ReportChainToggleAction,
): boolean {
  return (
    left.mode === right.mode &&
    left.controlLabel === right.controlLabel &&
    left.disabled === right.disabled &&
    left.preferActionLabel === right.preferActionLabel
  );
}

export function getReportChainRefreshAction({
  previewChainCount,
  visibleChainCount,
  hiddenActiveChainCount,
  loading = false,
  retry = false,
}: {
  previewChainCount: number;
  visibleChainCount: number;
  hiddenActiveChainCount: number;
  loading?: boolean;
  retry?: boolean;
}): ReportChainRefreshAction {
  const canRefresh = visibleChainCount > previewChainCount && hiddenActiveChainCount === 0;
  return {
    visible: canRefresh,
    controlLabel: canRefresh
      ? loading
        ? 'Refreshing stories...'
        : retry
          ? 'Retry refresh stories'
          : 'Refresh stories'
      : null,
    disabled: loading,
  };
}

export function areReportChainRefreshActionsEqual(
  left: ReportChainRefreshAction,
  right: ReportChainRefreshAction,
): boolean {
  return left.visible === right.visible && left.controlLabel === right.controlLabel && left.disabled === right.disabled;
}

export function getReportChainStoryChipLabel(visibleChainCount: number, action: ReportChainToggleAction): string {
  if (action.mode === 'expand' && action.preferActionLabel && action.controlLabel) {
    return action.controlLabel;
  }

  return `Active stories · ${visibleChainCount}`;
}
