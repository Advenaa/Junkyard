import { useCallback, useReducer } from 'react';
import {
  areReportChainRefreshActionsEqual,
  areReportChainToggleActionsEqual,
  type ReportChainRefreshAction,
  type ReportChainToggleAction,
} from './reportChains';

interface ReportPreviewState {
  previewBodyOverrides: Record<string, string>;
  leadChainLabelOverrides: Record<string, string>;
  leadChainHrefOverrides: Record<string, string>;
  focusedReportHrefOverrides: Record<string, string>;
  visibleChainCountOverrides: Record<string, number>;
  storyChipActionOverrides: Record<string, ReportChainToggleAction>;
  storyChipToggleRequests: Record<string, number>;
  refreshChipActionOverrides: Record<string, ReportChainRefreshAction>;
  refreshChipRequests: Record<string, number>;
}

type ReportPreviewAction =
  | {
      type: 'UPDATE_PREVIEW_BODY';
      reportId: string;
      fallbackBody: string;
      nextBody: string | null;
    }
  | {
      type: 'UPDATE_LEAD_CHAIN_LABEL';
      reportId: string;
      fallbackLabel: string | null;
      nextLabel: string | null;
    }
  | {
      type: 'UPDATE_LEAD_CHAIN_HREF';
      reportId: string;
      fallbackHref: string | null;
      nextHref: string | null;
    }
  | {
      type: 'UPDATE_FOCUSED_REPORT_HREF';
      reportId: string;
      fallbackHref: string | null;
      nextHref: string | null;
    }
  | {
      type: 'UPDATE_VISIBLE_CHAIN_COUNT';
      reportId: string;
      fallbackCount: number;
      nextCount: number;
    }
  | {
      type: 'UPDATE_STORY_CHIP_ACTION';
      reportId: string;
      fallbackAction: ReportChainToggleAction;
      nextAction: ReportChainToggleAction;
    }
  | {
      type: 'REQUEST_STORY_CHIP_TOGGLE';
      reportId: string;
    }
  | {
      type: 'UPDATE_REFRESH_CHIP_ACTION';
      reportId: string;
      fallbackAction: ReportChainRefreshAction;
      nextAction: ReportChainRefreshAction;
    }
  | {
      type: 'REQUEST_REFRESH_CHIP';
      reportId: string;
    }
  | { type: 'RESET' };

const initialReportPreviewState: ReportPreviewState = {
  previewBodyOverrides: {},
  leadChainLabelOverrides: {},
  leadChainHrefOverrides: {},
  focusedReportHrefOverrides: {},
  visibleChainCountOverrides: {},
  storyChipActionOverrides: {},
  storyChipToggleRequests: {},
  refreshChipActionOverrides: {},
  refreshChipRequests: {},
};

function reportPreviewReducer(state: ReportPreviewState, action: ReportPreviewAction): ReportPreviewState {
  switch (action.type) {
    case 'UPDATE_PREVIEW_BODY': {
      const { reportId, fallbackBody, nextBody } = action;

      if (!nextBody) return state;
      if (nextBody === fallbackBody) {
        if (!(reportId in state.previewBodyOverrides)) return state;
        const { [reportId]: _, ...previewBodyOverrides } = state.previewBodyOverrides;
        return { ...state, previewBodyOverrides };
      }
      if (state.previewBodyOverrides[reportId] === nextBody) return state;
      return {
        ...state,
        previewBodyOverrides: { ...state.previewBodyOverrides, [reportId]: nextBody },
      };
    }

    case 'UPDATE_LEAD_CHAIN_LABEL': {
      const { reportId, fallbackLabel, nextLabel } = action;

      if (!nextLabel) return state;
      if (nextLabel === fallbackLabel) {
        if (!(reportId in state.leadChainLabelOverrides)) return state;
        const { [reportId]: _, ...leadChainLabelOverrides } = state.leadChainLabelOverrides;
        return { ...state, leadChainLabelOverrides };
      }
      if (state.leadChainLabelOverrides[reportId] === nextLabel) return state;
      return {
        ...state,
        leadChainLabelOverrides: { ...state.leadChainLabelOverrides, [reportId]: nextLabel },
      };
    }

    case 'UPDATE_LEAD_CHAIN_HREF': {
      const { reportId, fallbackHref, nextHref } = action;

      if (!nextHref) return state;
      if (nextHref === fallbackHref) {
        if (!(reportId in state.leadChainHrefOverrides)) return state;
        const { [reportId]: _, ...leadChainHrefOverrides } = state.leadChainHrefOverrides;
        return { ...state, leadChainHrefOverrides };
      }
      if (state.leadChainHrefOverrides[reportId] === nextHref) return state;
      return {
        ...state,
        leadChainHrefOverrides: { ...state.leadChainHrefOverrides, [reportId]: nextHref },
      };
    }

    case 'UPDATE_FOCUSED_REPORT_HREF': {
      const { reportId, fallbackHref, nextHref } = action;

      if (!nextHref) return state;
      if (nextHref === fallbackHref) {
        if (!(reportId in state.focusedReportHrefOverrides)) return state;
        const { [reportId]: _, ...focusedReportHrefOverrides } = state.focusedReportHrefOverrides;
        return { ...state, focusedReportHrefOverrides };
      }
      if (state.focusedReportHrefOverrides[reportId] === nextHref) return state;
      return {
        ...state,
        focusedReportHrefOverrides: { ...state.focusedReportHrefOverrides, [reportId]: nextHref },
      };
    }

    case 'UPDATE_VISIBLE_CHAIN_COUNT': {
      const { reportId, fallbackCount, nextCount } = action;

      if (nextCount === fallbackCount) {
        if (!(reportId in state.visibleChainCountOverrides)) return state;
        const { [reportId]: _, ...visibleChainCountOverrides } = state.visibleChainCountOverrides;
        return { ...state, visibleChainCountOverrides };
      }
      if (state.visibleChainCountOverrides[reportId] === nextCount) return state;
      return {
        ...state,
        visibleChainCountOverrides: { ...state.visibleChainCountOverrides, [reportId]: nextCount },
      };
    }

    case 'UPDATE_STORY_CHIP_ACTION': {
      const { reportId, fallbackAction, nextAction } = action;

      if (areReportChainToggleActionsEqual(nextAction, fallbackAction)) {
        if (!(reportId in state.storyChipActionOverrides)) return state;
        const { [reportId]: _, ...storyChipActionOverrides } = state.storyChipActionOverrides;
        return { ...state, storyChipActionOverrides };
      }
      if (
        state.storyChipActionOverrides[reportId] &&
        areReportChainToggleActionsEqual(state.storyChipActionOverrides[reportId], nextAction)
      ) {
        return state;
      }
      return {
        ...state,
        storyChipActionOverrides: { ...state.storyChipActionOverrides, [reportId]: nextAction },
      };
    }

    case 'REQUEST_STORY_CHIP_TOGGLE': {
      const { reportId } = action;

      return {
        ...state,
        storyChipToggleRequests: {
          ...state.storyChipToggleRequests,
          [reportId]: (state.storyChipToggleRequests[reportId] ?? 0) + 1,
        },
      };
    }

    case 'UPDATE_REFRESH_CHIP_ACTION': {
      const { reportId, fallbackAction, nextAction } = action;

      if (areReportChainRefreshActionsEqual(nextAction, fallbackAction)) {
        if (!(reportId in state.refreshChipActionOverrides)) return state;
        const { [reportId]: _, ...refreshChipActionOverrides } = state.refreshChipActionOverrides;
        return { ...state, refreshChipActionOverrides };
      }
      if (
        state.refreshChipActionOverrides[reportId] &&
        areReportChainRefreshActionsEqual(state.refreshChipActionOverrides[reportId], nextAction)
      ) {
        return state;
      }
      return {
        ...state,
        refreshChipActionOverrides: { ...state.refreshChipActionOverrides, [reportId]: nextAction },
      };
    }

    case 'REQUEST_REFRESH_CHIP': {
      const { reportId } = action;

      return {
        ...state,
        refreshChipRequests: {
          ...state.refreshChipRequests,
          [reportId]: (state.refreshChipRequests[reportId] ?? 0) + 1,
        },
      };
    }

    case 'RESET':
      return initialReportPreviewState;
  }
}

export function useReportPreviewState() {
  const [state, dispatch] = useReducer(reportPreviewReducer, initialReportPreviewState);

  const updateReportPreviewBody = useCallback((reportId: string, fallbackBody: string, nextBody: string | null) => {
    dispatch({
      type: 'UPDATE_PREVIEW_BODY',
      reportId,
      fallbackBody,
      nextBody,
    });
  }, []);

  const updateLeadChainLabel = useCallback(
    (reportId: string, fallbackLabel: string | null, nextLabel: string | null) => {
      dispatch({
        type: 'UPDATE_LEAD_CHAIN_LABEL',
        reportId,
        fallbackLabel,
        nextLabel,
      });
    },
    [],
  );

  const updateLeadChainHref = useCallback((reportId: string, fallbackHref: string | null, nextHref: string | null) => {
    dispatch({
      type: 'UPDATE_LEAD_CHAIN_HREF',
      reportId,
      fallbackHref,
      nextHref,
    });
  }, []);

  const updateFocusedReportHref = useCallback(
    (reportId: string, fallbackHref: string | null, nextHref: string | null) => {
      dispatch({
        type: 'UPDATE_FOCUSED_REPORT_HREF',
        reportId,
        fallbackHref,
        nextHref,
      });
    },
    [],
  );

  const updateVisibleChainCount = useCallback((reportId: string, fallbackCount: number, nextCount: number) => {
    dispatch({
      type: 'UPDATE_VISIBLE_CHAIN_COUNT',
      reportId,
      fallbackCount,
      nextCount,
    });
  }, []);

  const updateStoryChipAction = useCallback(
    (reportId: string, fallbackAction: ReportChainToggleAction, nextAction: ReportChainToggleAction) => {
      dispatch({
        type: 'UPDATE_STORY_CHIP_ACTION',
        reportId,
        fallbackAction,
        nextAction,
      });
    },
    [],
  );

  const requestStoryChipToggle = useCallback((reportId: string) => {
    dispatch({ type: 'REQUEST_STORY_CHIP_TOGGLE', reportId });
  }, []);

  const updateRefreshChipAction = useCallback(
    (reportId: string, fallbackAction: ReportChainRefreshAction, nextAction: ReportChainRefreshAction) => {
      dispatch({
        type: 'UPDATE_REFRESH_CHIP_ACTION',
        reportId,
        fallbackAction,
        nextAction,
      });
    },
    [],
  );

  const requestRefreshChip = useCallback((reportId: string) => {
    dispatch({ type: 'REQUEST_REFRESH_CHIP', reportId });
  }, []);

  return {
    previewBodyOverrides: state.previewBodyOverrides,
    leadChainLabelOverrides: state.leadChainLabelOverrides,
    leadChainHrefOverrides: state.leadChainHrefOverrides,
    focusedReportHrefOverrides: state.focusedReportHrefOverrides,
    visibleChainCountOverrides: state.visibleChainCountOverrides,
    storyChipActionOverrides: state.storyChipActionOverrides,
    storyChipToggleRequests: state.storyChipToggleRequests,
    refreshChipActionOverrides: state.refreshChipActionOverrides,
    refreshChipRequests: state.refreshChipRequests,
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
