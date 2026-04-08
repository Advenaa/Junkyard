interface ReportSecondaryPreviewInput {
  activeChainCount: number;
  eventChains?: string[];
  firstMovers?: string[];
  priceAlerts?: string[];
  alphaSignals?: string[];
  marketCatalysts?: string[];
  regionalDivergence?: string[];
  narrativeShifts?: string[];
  unusualActivity?: string[];
  macroAlerts?: string[];
}

export interface ReportSecondaryPreview {
  label:
    | 'Event Chain'
    | 'First Mover'
    | 'Price Alert'
    | 'Alpha Signal'
    | 'Market Catalyst'
    | 'Regional Divergence'
    | 'Narrative Shift'
    | 'Unusual Activity'
    | 'Macro Alert';
  text: string;
}

function firstNonEmpty(values?: string[]): string | null {
  const value = values?.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
  return value?.trim() ?? null;
}

export function getReportSecondaryPreview({
  activeChainCount,
  eventChains,
  firstMovers,
  priceAlerts,
  alphaSignals,
  marketCatalysts,
  regionalDivergence,
  narrativeShifts,
  unusualActivity,
  macroAlerts,
}: ReportSecondaryPreviewInput): ReportSecondaryPreview | null {
  if (activeChainCount > 0) {
    return null;
  }

  const eventChain = firstNonEmpty(eventChains);
  if (eventChain) {
    return {
      label: 'Event Chain',
      text: eventChain,
    };
  }

  const firstMover = firstNonEmpty(firstMovers);
  if (firstMover) {
    return {
      label: 'First Mover',
      text: firstMover,
    };
  }

  const priceAlert = firstNonEmpty(priceAlerts);
  if (priceAlert) {
    return {
      label: 'Price Alert',
      text: priceAlert,
    };
  }

  const alphaSignal = firstNonEmpty(alphaSignals);
  if (alphaSignal) {
    return {
      label: 'Alpha Signal',
      text: alphaSignal,
    };
  }

  const marketCatalyst = firstNonEmpty(marketCatalysts);
  if (marketCatalyst) {
    return {
      label: 'Market Catalyst',
      text: marketCatalyst,
    };
  }

  const regionalDivergenceLine = firstNonEmpty(regionalDivergence);
  if (regionalDivergenceLine) {
    return {
      label: 'Regional Divergence',
      text: regionalDivergenceLine,
    };
  }

  const narrativeShift = firstNonEmpty(narrativeShifts);
  if (narrativeShift) {
    return {
      label: 'Narrative Shift',
      text: narrativeShift,
    };
  }

  const unusualActivityLine = firstNonEmpty(unusualActivity);
  if (unusualActivityLine) {
    return {
      label: 'Unusual Activity',
      text: unusualActivityLine,
    };
  }

  const macroAlert = firstNonEmpty(macroAlerts);
  if (macroAlert) {
    return {
      label: 'Macro Alert',
      text: macroAlert,
    };
  }

  return null;
}
