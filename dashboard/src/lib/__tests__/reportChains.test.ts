import { describe, expect, it } from 'vitest';
import {
  areReportChainRefreshActionsEqual,
  areReportChainToggleActionsEqual,
  buildFocusedReportHref,
  buildLeadChainHref,
  buildLeadChainLabel,
  buildLeadReportHref,
  buildSummaryChainHref,
  getReportChainRefreshAction,
  getReportChainStoryChipLabel,
  getReportChainToggleAction,
} from '../reportChains';

describe('reportChains', () => {
  it('builds focused summary chain hrefs', () => {
    expect(buildSummaryChainHref('summary-9', 'chain-root-1')).toBe('/summaries/summary-9?chain=chain-root-1');
  });

  it('builds focused report chain hrefs', () => {
    expect(buildFocusedReportHref('report-1', 'chain-root-1')).toBe('/reports/report-1?chain=chain-root-1');
  });

  it('builds lead-chain labels from drilldowns', () => {
    expect(
      buildLeadChainLabel({
        rootId: 'chain-root-1',
        entityName: 'Bitcoin',
        eventCount: 3,
        firstEventTime: 0,
        latestEventTime: 1,
        eventTypes: ['exploit', 'governance'],
        latestSummaryId: 'summary-9',
        latestEventType: 'governance',
        latestEventDescription: 'Governance response kept the chain active.',
      }),
    ).toBe('Bitcoin · governance');
  });

  it('builds lead-chain hrefs from drilldowns', () => {
    expect(
      buildLeadChainHref({
        rootId: 'chain-root-1',
        entityName: 'Bitcoin',
        eventCount: 3,
        firstEventTime: 0,
        latestEventTime: 1,
        eventTypes: ['exploit', 'governance'],
        latestSummaryId: 'summary-9',
        latestEventType: 'governance',
        latestEventDescription: 'Governance response kept the chain active.',
      }),
    ).toBe('/summaries/summary-9?chain=chain-root-1');
  });

  it('builds lead-report hrefs from drilldowns', () => {
    expect(
      buildLeadReportHref('report-1', {
        rootId: 'chain-root-1',
        entityName: 'Bitcoin',
        eventCount: 3,
        firstEventTime: 0,
        latestEventTime: 1,
        eventTypes: ['exploit', 'governance'],
        latestSummaryId: 'summary-9',
        latestEventType: 'governance',
        latestEventDescription: 'Governance response kept the chain active.',
      }),
    ).toBe('/reports/report-1?chain=chain-root-1');
  });

  it('builds expand actions for hidden preview chains', () => {
    expect(
      getReportChainToggleAction({
        previewChainCount: 2,
        visibleChainCount: 2,
        hiddenActiveChainCount: 3,
      }),
    ).toEqual({
      mode: 'expand',
      controlLabel: 'Show 3 more active chains',
      disabled: false,
    });
  });

  it('builds collapse actions for expanded preview chains', () => {
    expect(
      getReportChainToggleAction({
        previewChainCount: 2,
        visibleChainCount: 5,
        hiddenActiveChainCount: 0,
        loading: true,
      }),
    ).toEqual({
      mode: 'collapse',
      controlLabel: 'Show fewer chains',
      disabled: true,
    });
  });

  it('builds loading labels for expanding preview chains', () => {
    expect(
      getReportChainToggleAction({
        previewChainCount: 2,
        visibleChainCount: 2,
        hiddenActiveChainCount: 1,
        loading: true,
      }),
    ).toEqual({
      mode: 'expand',
      controlLabel: 'Loading stories...',
      disabled: true,
      preferActionLabel: true,
    });
  });

  it('builds retry labels for failed preview-chain expansion', () => {
    expect(
      getReportChainToggleAction({
        previewChainCount: 2,
        visibleChainCount: 2,
        hiddenActiveChainCount: 1,
        retry: true,
      }),
    ).toEqual({
      mode: 'expand',
      controlLabel: 'Retry loading stories',
      disabled: false,
      preferActionLabel: true,
    });
  });

  it('compares toggle actions by mode, label, and loading state', () => {
    expect(
      areReportChainToggleActionsEqual(
        {
          mode: 'expand',
          controlLabel: 'Show 1 more active chain',
          disabled: false,
        },
        {
          mode: 'expand',
          controlLabel: 'Show 1 more active chain',
          disabled: false,
        },
      ),
    ).toBe(true);

    expect(
      areReportChainToggleActionsEqual(
        {
          mode: 'expand',
          controlLabel: 'Show 1 more active chain',
          disabled: false,
        },
        {
          mode: 'collapse',
          controlLabel: 'Show fewer chains',
          disabled: false,
        },
      ),
    ).toBe(false);
  });

  it('builds refresh actions for fully expanded previews', () => {
    expect(
      getReportChainRefreshAction({
        previewChainCount: 2,
        visibleChainCount: 5,
        hiddenActiveChainCount: 0,
      }),
    ).toEqual({
      visible: true,
      controlLabel: 'Refresh stories',
      disabled: false,
    });
  });

  it('builds loading labels for refresh actions', () => {
    expect(
      getReportChainRefreshAction({
        previewChainCount: 2,
        visibleChainCount: 5,
        hiddenActiveChainCount: 0,
        loading: true,
      }),
    ).toEqual({
      visible: true,
      controlLabel: 'Refreshing stories...',
      disabled: true,
    });
  });

  it('builds retry labels for failed refresh actions', () => {
    expect(
      getReportChainRefreshAction({
        previewChainCount: 2,
        visibleChainCount: 5,
        hiddenActiveChainCount: 0,
        retry: true,
      }),
    ).toEqual({
      visible: true,
      controlLabel: 'Retry refresh stories',
      disabled: false,
    });
  });

  it('hides refresh actions while hidden chains still remain', () => {
    expect(
      getReportChainRefreshAction({
        previewChainCount: 2,
        visibleChainCount: 3,
        hiddenActiveChainCount: 2,
        loading: true,
      }),
    ).toEqual({
      visible: false,
      controlLabel: null,
      disabled: true,
    });
  });

  it('compares refresh actions by visibility, label, and loading state', () => {
    expect(
      areReportChainRefreshActionsEqual(
        {
          visible: true,
          controlLabel: 'Refresh stories',
          disabled: false,
        },
        {
          visible: true,
          controlLabel: 'Refresh stories',
          disabled: false,
        },
      ),
    ).toBe(true);

    expect(
      areReportChainRefreshActionsEqual(
        {
          visible: true,
          controlLabel: 'Refresh stories',
          disabled: false,
        },
        {
          visible: false,
          controlLabel: null,
          disabled: false,
        },
      ),
    ).toBe(false);
  });

  it('uses loading labels for the header story chip while expansion is pending', () => {
    expect(
      getReportChainStoryChipLabel(2, {
        mode: 'expand',
        controlLabel: 'Loading stories...',
        disabled: true,
        preferActionLabel: true,
      }),
    ).toBe('Loading stories...');

    expect(
      getReportChainStoryChipLabel(2, {
        mode: 'expand',
        controlLabel: 'Retry loading stories',
        disabled: false,
        preferActionLabel: true,
      }),
    ).toBe('Retry loading stories');

    expect(
      getReportChainStoryChipLabel(5, {
        mode: 'collapse',
        controlLabel: 'Show fewer chains',
        disabled: false,
      }),
    ).toBe('Active stories · 5');
  });
});
