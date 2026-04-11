import type { Logger } from './logger.js';
import type { Config } from './config.js';

export type FeatureKey = 'embeddings' | 'prices' | 'macro';

export interface FeatureFlag {
  disabled: boolean;
  missingEnv: string;
  disables: readonly string[];
  keyRejected: boolean;
}

export type DisabledFeatures = Readonly<Record<FeatureKey, FeatureFlag>>;

const EMBEDDINGS_DISABLES = Object.freeze(['embeddings', 'RAG chat', 'semantic search', 'narrative clustering']);

const PRICES_DISABLES = Object.freeze(['price feeds', 'contrarian signals', 'entity price API']);

const MACRO_DISABLES = Object.freeze(['macro snapshots', 'cross-market correlation', 'macro regime detection']);

export function computeDisabledFeatures(config: Config): DisabledFeatures {
  const hasGemini = Boolean(config.geminiApiKey || config.googleApiKey);
  const hasCoinGecko = Boolean(config.coingeckoApiKey);
  const hasFred = Boolean(config.fredApiKey);

  return Object.freeze({
    embeddings: {
      disabled: !hasGemini,
      missingEnv: 'GEMINI_API_KEY',
      disables: EMBEDDINGS_DISABLES,
      keyRejected: false,
    },
    prices: {
      disabled: !hasCoinGecko,
      missingEnv: 'COINGECKO_API_KEY',
      disables: PRICES_DISABLES,
      keyRejected: false,
    },
    macro: {
      disabled: !hasFred,
      missingEnv: 'FRED_API_KEY',
      disables: MACRO_DISABLES,
      keyRejected: false,
    },
  });
}

export function isFeatureDisabled(flags: DisabledFeatures, key: FeatureKey): boolean {
  return flags[key].disabled;
}

export type FeatureDisabledReason = 'missing_env' | 'auth_failed';

export interface FeatureDisabledResponse {
  error: 'feature_disabled';
  feature: FeatureKey;
  missingEnv: string;
  disables: readonly string[];
  reason: FeatureDisabledReason;
}

export function featureDisabledResponse(flags: DisabledFeatures, feature: FeatureKey): FeatureDisabledResponse {
  const flag = flags[feature];
  return {
    error: 'feature_disabled',
    feature,
    missingEnv: flag.missingEnv,
    disables: flag.disables,
    reason: flag.keyRejected ? 'auth_failed' : 'missing_env',
  };
}

export function markFeatureKeyRejected(flags: DisabledFeatures, feature: FeatureKey, log: Logger): void {
  const flag = flags[feature];
  if (flag.keyRejected) return;

  flag.keyRejected = true;
  flag.disabled = true;

  log.warn(
    { feature, missingEnv: flag.missingEnv },
    `Feature "${feature}" disabled at runtime: upstream rejected ${flag.missingEnv}`,
  );
}

export function formatStartupWarning(flags: DisabledFeatures): string | null {
  const disabled = (Object.keys(flags) as FeatureKey[]).filter((key) => flags[key].disabled);
  if (disabled.length === 0) return null;

  const lines: string[] = ['WARNING: Optional API keys missing — the following features are disabled:'];
  for (const key of disabled) {
    const flag = flags[key];
    lines.push(`  • ${flag.missingEnv} → ${flag.disables.join(', ')}`);
  }
  lines.push('Set the missing env vars on the server to enable these features.');
  return lines.join('\n');
}
