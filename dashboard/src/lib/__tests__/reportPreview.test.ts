import { describe, expect, it } from 'vitest';
import { getReportSecondaryPreview } from '../reportPreview';

describe('getReportSecondaryPreview', () => {
  it('returns a narrative shift preview when no higher-priority preview is present', () => {
    expect(
      getReportSecondaryPreview({
        activeChainCount: 0,
        narrativeShifts: ['Stablecoin rotation broadened into a wider alt-liquidity narrative.'],
        unusualActivity: ['Copy-trade style overlap surged around a thinly traded token.'],
        macroAlerts: ['Crypto stayed resilient even as the dollar and rates both pushed higher.'],
      }),
    ).toEqual({
      label: 'Narrative Shift',
      text: 'Stablecoin rotation broadened into a wider alt-liquidity narrative.',
    });
  });

  it('keeps market catalysts ahead of narrative shifts in the shared preview order', () => {
    expect(
      getReportSecondaryPreview({
        activeChainCount: 0,
        marketCatalysts: ['US CPI lands tomorrow and remains the clearest scheduled volatility catalyst.'],
        narrativeShifts: ['Stablecoin rotation broadened into a wider alt-liquidity narrative.'],
        unusualActivity: ['Copy-trade style overlap surged around a thinly traded token.'],
        macroAlerts: ['Crypto stayed resilient even as the dollar and rates both pushed higher.'],
      }),
    ).toEqual({
      label: 'Market Catalyst',
      text: 'US CPI lands tomorrow and remains the clearest scheduled volatility catalyst.',
    });
  });

  it('keeps regional divergence ahead of narrative shifts in the shared preview order', () => {
    expect(
      getReportSecondaryPreview({
        activeChainCount: 0,
        regionalDivergence: ['Bitcoin: EN stayed bullish while ID leaned bearish after the latest breakout attempt.'],
        narrativeShifts: ['Stablecoin rotation broadened into a wider alt-liquidity narrative.'],
        unusualActivity: ['Copy-trade style overlap surged around a thinly traded token.'],
        macroAlerts: ['Crypto stayed resilient even as the dollar and rates both pushed higher.'],
      }),
    ).toEqual({
      label: 'Regional Divergence',
      text: 'Bitcoin: EN stayed bullish while ID leaned bearish after the latest breakout attempt.',
    });
  });

  it('keeps market catalysts ahead of regional divergence in the shared preview order', () => {
    expect(
      getReportSecondaryPreview({
        activeChainCount: 0,
        marketCatalysts: ['ETF approval odds reset tomorrow and remain the clearest scheduled volatility catalyst.'],
        regionalDivergence: ['Bitcoin: EN stayed bullish while ID leaned bearish after the latest breakout attempt.'],
        narrativeShifts: ['Stablecoin rotation broadened into a wider alt-liquidity narrative.'],
        unusualActivity: ['Copy-trade style overlap surged around a thinly traded token.'],
        macroAlerts: ['Crypto stayed resilient even as the dollar and rates both pushed higher.'],
      }),
    ).toEqual({
      label: 'Market Catalyst',
      text: 'ETF approval odds reset tomorrow and remain the clearest scheduled volatility catalyst.',
    });
  });

  it('suppresses secondary previews entirely when active chains are present', () => {
    expect(
      getReportSecondaryPreview({
        activeChainCount: 2,
        narrativeShifts: ['Stablecoin rotation broadened into a wider alt-liquidity narrative.'],
      }),
    ).toBeNull();
  });
});
