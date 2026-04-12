import { useCallback, useState } from 'react';
import {
  areReportChainRefreshActionsEqual,
  areReportChainToggleActionsEqual,
  type ReportChainRefreshAction,
  type ReportChainToggleAction,
} from './reportChains';

export function useReportPreviewState() {
  const [previewBodyOverrides, setPreviewBodyOverrides] = useState<Record<string, string>>({});
  const [leadChainLabelOverrides, setLeadChainLabelOverrides] = useState<Record<string, string>>({});
  const [leadChainHrefOverrides, setLeadChainHrefOverrides] = useState<Record<string, string>>({});
  const [focusedReportHrefOverrides, setFocusedReportHrefOverrides] = useState<Record<string, string>>({});
  const [visibleChainCountOverrides, setVisibleChainCountOverrides] = useState<Record<string, number>>({});
  const [storyChipActionOverrides, setStoryChipActionOverrides] = useState<Record<string, ReportChainToggleAction>>({});
  const [storyChipToggleRequests, setStoryChipToggleRequests] = useState<Record<string, number>>({});
  const [refreshChipActionOverrides, setRefreshChipActionOverrides] = useState<
    Record<string, ReportChainRefreshAction>
  >({});
  const [refreshChipRequests, setRefreshChipRequests] = useState<Record<string, number>>({});

  const updateReportPreviewBody = useCallback((reportId: string, fallbackBody: string, nextBody: string | null) => {
    if (!nextBody) return;

    setPreviewBodyOverrides((prev) => {
      if (nextBody === fallbackBody) {
        if (!(reportId in prev)) return prev;
        const next = { ...prev };
        delete next[reportId];
        return next;
      }
      if (prev[reportId] === nextBody) return prev;
      return { ...prev, [reportId]: nextBody };
    });
  }, []);

  const updateLeadChainLabel = useCallback(
    (reportId: string, fallbackLabel: string | null, nextLabel: string | null) => {
      if (!nextLabel) return;

      setLeadChainLabelOverrides((prev) => {
        if (nextLabel === fallbackLabel) {
          if (!(reportId in prev)) return prev;
          const next = { ...prev };
          delete next[reportId];
          return next;
        }
        if (prev[reportId] === nextLabel) return prev;
        return { ...prev, [reportId]: nextLabel };
      });
    },
    [],
  );

  const updateLeadChainHref = useCallback((reportId: string, fallbackHref: string | null, nextHref: string | null) => {
    if (!nextHref) return;

    setLeadChainHrefOverrides((prev) => {
      if (nextHref === fallbackHref) {
        if (!(reportId in prev)) return prev;
        const next = { ...prev };
        delete next[reportId];
        return next;
      }
      if (prev[reportId] === nextHref) return prev;
      return { ...prev, [reportId]: nextHref };
    });
  }, []);

  const updateFocusedReportHref = useCallback(
    (reportId: string, fallbackHref: string | null, nextHref: string | null) => {
      if (!nextHref) return;

      setFocusedReportHrefOverrides((prev) => {
        if (nextHref === fallbackHref) {
          if (!(reportId in prev)) return prev;
          const next = { ...prev };
          delete next[reportId];
          return next;
        }
        if (prev[reportId] === nextHref) return prev;
        return { ...prev, [reportId]: nextHref };
      });
    },
    [],
  );

  const updateVisibleChainCount = useCallback((reportId: string, fallbackCount: number, nextCount: number) => {
    setVisibleChainCountOverrides((prev) => {
      if (nextCount === fallbackCount) {
        if (!(reportId in prev)) return prev;
        const next = { ...prev };
        delete next[reportId];
        return next;
      }
      if (prev[reportId] === nextCount) return prev;
      return { ...prev, [reportId]: nextCount };
    });
  }, []);

  const updateStoryChipAction = useCallback(
    (reportId: string, fallbackAction: ReportChainToggleAction, nextAction: ReportChainToggleAction) => {
      setStoryChipActionOverrides((prev) => {
        if (areReportChainToggleActionsEqual(nextAction, fallbackAction)) {
          if (!(reportId in prev)) return prev;
          const next = { ...prev };
          delete next[reportId];
          return next;
        }
        if (prev[reportId] && areReportChainToggleActionsEqual(prev[reportId], nextAction)) return prev;
        return { ...prev, [reportId]: nextAction };
      });
    },
    [],
  );

  const requestStoryChipToggle = useCallback((reportId: string) => {
    setStoryChipToggleRequests((prev) => ({
      ...prev,
      [reportId]: (prev[reportId] ?? 0) + 1,
    }));
  }, []);

  const updateRefreshChipAction = useCallback(
    (reportId: string, fallbackAction: ReportChainRefreshAction, nextAction: ReportChainRefreshAction) => {
      setRefreshChipActionOverrides((prev) => {
        if (areReportChainRefreshActionsEqual(nextAction, fallbackAction)) {
          if (!(reportId in prev)) return prev;
          const next = { ...prev };
          delete next[reportId];
          return next;
        }
        if (prev[reportId] && areReportChainRefreshActionsEqual(prev[reportId], nextAction)) return prev;
        return { ...prev, [reportId]: nextAction };
      });
    },
    [],
  );

  const requestRefreshChip = useCallback((reportId: string) => {
    setRefreshChipRequests((prev) => ({
      ...prev,
      [reportId]: (prev[reportId] ?? 0) + 1,
    }));
  }, []);

  return {
    previewBodyOverrides,
    leadChainLabelOverrides,
    leadChainHrefOverrides,
    focusedReportHrefOverrides,
    visibleChainCountOverrides,
    storyChipActionOverrides,
    storyChipToggleRequests,
    refreshChipActionOverrides,
    refreshChipRequests,
    updateReportPreviewBody,
    updateLeadChainLabel,
    updateLeadChainHref,
    updateFocusedReportHref,
    updateVisibleChainCount,
    updateStoryChipAction,
    requestStoryChipToggle,
    updateRefreshChipAction,
    requestRefreshChip,
  };
}
