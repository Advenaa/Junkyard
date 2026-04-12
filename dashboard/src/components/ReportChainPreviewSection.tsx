import { memo } from 'react';
import { Link } from 'react-router';
import {
  buildSummaryChainHref,
  type ReportChainRefreshAction,
  type ReportChainToggleAction,
} from '../lib/reportChains';
import type { ReportChainDrilldown } from '../lib/types';
import { getChainPreviewLabel, getHiddenChainsLabel, useChainPreview } from '../lib/useChainPreview';

export interface ReportChainPreviewSectionProps {
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

export const ReportChainPreviewSection = memo(function ReportChainPreviewSection(
  props: ReportChainPreviewSectionProps,
) {
  const {
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
  } = useChainPreview(props);

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
});
