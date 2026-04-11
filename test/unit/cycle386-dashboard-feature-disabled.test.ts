/**
 * Cycle 386 — Dashboard empty states for disabled optional features (FG-001)
 *
 * Structural regression checks: every surface that depends on an optional
 * API key (embeddings, prices, macro) wires up StatusProvider, FeatureDisabledCard,
 * and either the useStatus feature-check helpers or the FeatureDisabledError guard.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relPath: string): string =>
  readFileSync(new URL(`../../dashboard/src/${relPath}`, import.meta.url), 'utf-8');

const routerSrc = read('router.tsx');
const apiSrc = read('lib/api.ts');
const typesSrc = read('lib/types.ts');
const statusProviderSrc = read('components/StatusProvider.tsx');
const featureDisabledCardSrc = read('components/FeatureDisabledCard.tsx');
const reportViewSrc = read('pages/ReportView.tsx');
const macroSectionSrc = read('pages/ReportView/sections/MacroSection.tsx');
const priceWatchSectionSrc = read('pages/ReportView/sections/PriceWatchSection.tsx');
const narrativeSectionSrc = read('pages/ReportView/sections/NarrativeSection.tsx');
const reportListSrc = read('pages/ReportList.tsx');
const chatSrc = read('pages/Chat.tsx');
const settingsSrc = read('pages/Settings.tsx');

describe('FG-001 — wiring scaffolding exists', () => {
  it('StatusProvider wraps ErrorBoundary inside AuthProvider in router.tsx', () => {
    assert.match(routerSrc, /<StatusProvider>/);
    assert.match(routerSrc, /<\/StatusProvider>/);
    const authIdx = routerSrc.indexOf('<AuthProvider>');
    const statusIdx = routerSrc.indexOf('<StatusProvider>');
    const errorIdx = routerSrc.indexOf('<ErrorBoundary>');
    assert.ok(
      authIdx > -1 && statusIdx > authIdx && errorIdx > statusIdx,
      'expected AuthProvider > StatusProvider > ErrorBoundary nesting',
    );
  });

  it('FeatureKey / DisabledFeatureSummary / StatusSnapshot types declared', () => {
    assert.match(typesSrc, /export type FeatureKey/);
    assert.match(typesSrc, /embeddings['"]?\s*\|\s*['"]prices['"]?\s*\|\s*['"]macro/);
    assert.match(typesSrc, /export interface DisabledFeatureSummary/);
    assert.match(typesSrc, /export interface StatusSnapshot/);
    assert.match(typesSrc, /disabledFeatures:\s*DisabledFeatureSummary\[\]/);
  });

  it('apiFetch maps 503 feature_disabled responses to FeatureDisabledError', () => {
    assert.match(apiSrc, /class FeatureDisabledError/);
    assert.match(apiSrc, /isFeatureDisabledError/);
    assert.match(apiSrc, /res\.status\s*===\s*503/);
    assert.match(apiSrc, /feature_disabled/);
  });

  it('StatusProvider exposes isFeatureDisabled + getDisabledFeature', () => {
    assert.match(statusProviderSrc, /isFeatureDisabled/);
    assert.match(statusProviderSrc, /getDisabledFeature/);
    assert.match(statusProviderSrc, /apiFetch[^(]*\(\s*['"]\/status['"]/);
  });

  it('FeatureDisabledCard accepts feature + variant props', () => {
    assert.match(featureDisabledCardSrc, /feature:\s*DisabledFeatureSummary/);
    assert.match(featureDisabledCardSrc, /variant\??:\s*['"](panel|inline|chip)['"]/);
  });
});

describe('FG-001 — ReportView surfaces guarded', () => {
  it('ReportView imports useStatus and isFeatureDisabledError', () => {
    assert.match(reportViewSrc, /import\s*\{[^}]*useStatus[^}]*\}\s*from\s*['"][^'"]*StatusProvider/);
    assert.match(reportViewSrc, /isFeatureDisabledError/);
  });

  it('Macro, PriceWatch, and Narrative section components import FeatureDisabledCard', () => {
    assert.match(macroSectionSrc, /import\s*\{[^}]*FeatureDisabledCard[^}]*\}\s*from\s*['"][^'"]*FeatureDisabledCard/);
    assert.match(
      priceWatchSectionSrc,
      /import\s*\{[^}]*FeatureDisabledCard[^}]*\}\s*from\s*['"][^'"]*FeatureDisabledCard/,
    );
    assert.match(
      narrativeSectionSrc,
      /import\s*\{[^}]*FeatureDisabledCard[^}]*\}\s*from\s*['"][^'"]*FeatureDisabledCard/,
    );
  });

  it('Macro, PriceWatch, and Narrative sections each render a FeatureDisabledCard surface', () => {
    assert.match(macroSectionSrc, /<FeatureDisabledCard/);
    assert.match(priceWatchSectionSrc, /<FeatureDisabledCard/);
    assert.match(narrativeSectionSrc, /<FeatureDisabledCard/);
  });

  it('ReportView renders MacroSection, PriceWatchSection, and NarrativeSection', () => {
    assert.match(reportViewSrc, /<MacroSection/);
    assert.match(reportViewSrc, /<PriceWatchSection/);
    assert.match(reportViewSrc, /<NarrativeSection/);
  });

  it('ReportView calls useStatus.getDisabledFeature for all three feature keys', () => {
    assert.match(reportViewSrc, /getDisabledFeature\(['"]macro['"]\)/);
    assert.match(reportViewSrc, /getDisabledFeature\(['"]prices['"]\)/);
    assert.match(reportViewSrc, /getDisabledFeature\(['"]embeddings['"]\)/);
  });
});

describe('FG-001 — ReportList narrative surface guarded', () => {
  it('imports useStatus + FeatureDisabledCard', () => {
    assert.match(reportListSrc, /useStatus/);
    assert.match(reportListSrc, /FeatureDisabledCard/);
  });

  it('checks embeddings disabled state before fetching/rendering narratives', () => {
    assert.match(reportListSrc, /isFeatureDisabled\(['"]embeddings['"]\)|getDisabledFeature\(['"]embeddings['"]\)/);
  });
});

describe('FG-001 — Chat RAG banner guarded', () => {
  it('imports useStatus + FeatureDisabledCard', () => {
    assert.match(chatSrc, /useStatus/);
    assert.match(chatSrc, /FeatureDisabledCard/);
  });

  it('renders FeatureDisabledCard gated on embeddings', () => {
    assert.match(chatSrc, /getDisabledFeature\(['"]embeddings['"]\)/);
    assert.match(chatSrc, /<FeatureDisabledCard[\s\S]*?variant=['"]inline['"]/);
  });
});

describe('FG-001 — Settings pipeline + entities tabs guarded', () => {
  it('imports useStatus + FeatureDisabledCard + isFeatureDisabledError', () => {
    assert.match(settingsSrc, /useStatus/);
    assert.match(settingsSrc, /FeatureDisabledCard/);
    assert.match(settingsSrc, /isFeatureDisabledError/);
  });

  it('PipelineTab guards macro and embeddings features', () => {
    assert.match(settingsSrc, /getDisabledFeature\(['"]macro['"]\)/);
    assert.match(settingsSrc, /getDisabledFeature\(['"]embeddings['"]\)/);
  });

  it('EntitiesTab guards the prices feature for the price card', () => {
    assert.match(settingsSrc, /getDisabledFeature\(['"]prices['"]\)/);
    assert.match(settingsSrc, /pricesDisabled/);
  });

  it('renders at least three FeatureDisabledCard surfaces in Settings (macro, narrative, price)', () => {
    const cardMatches = settingsSrc.match(/<FeatureDisabledCard/g);
    assert.ok(
      cardMatches && cardMatches.length >= 3,
      `expected >=3 FeatureDisabledCard renders in Settings, found ${cardMatches?.length ?? 0}`,
    );
  });
});
