import type { MacroRegime, MacroRegimeHistory } from './types';

export function macroRegimeToneClasses(classification: MacroRegime['classification']): string {
  switch (classification) {
    case 'risk-on':
      return 'bg-accent-green/15 text-accent-green';
    case 'risk-off':
      return 'bg-accent-red/15 text-accent-red';
    case 'transition':
      return 'bg-[#c68a2b]/15 text-[#f2c66d]';
    case 'unclear':
      return 'bg-surface-raised text-text-secondary';
  }
}

export function formatMacroRegimeLabel(classification: MacroRegime['classification']): string {
  switch (classification) {
    case 'risk-on':
      return 'Risk-on';
    case 'risk-off':
      return 'Risk-off';
    case 'transition':
      return 'Transition';
    case 'unclear':
      return 'Unclear';
  }
}

export function formatMacroRegimePreview(regime: MacroRegime, history?: MacroRegimeHistory | null): string {
  const label = formatMacroRegimeLabel(regime.classification);
  if (history && history.streakDays > 1) {
    return `${label} · Day ${history.streakDays}`;
  }
  return label;
}

export function buildMacroRegimePreviewTitle(regime: MacroRegime, history?: MacroRegimeHistory | null): string {
  const segments = [`${Math.round(regime.confidence * 100)}% confidence`, regime.rationale];
  if (history && history.streakDays > 0) {
    segments.unshift(`Day ${history.streakDays} of current daily regime`);
    if (history.previousClassification) {
      segments.push(`Previous ${formatMacroRegimeLabel(history.previousClassification)}`);
    }
  }
  return segments.join(' | ');
}
