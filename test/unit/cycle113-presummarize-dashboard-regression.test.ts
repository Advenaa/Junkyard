import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const preSummarizeSrc = readFileSync(new URL('../../src/pre-summarize/index.ts', import.meta.url), 'utf-8');

const settingsSrc = [
  'dashboard/src/pages/Settings/index.tsx',
  'dashboard/src/pages/Settings/types.ts',
  'dashboard/src/pages/Settings/api.ts',
  'dashboard/src/pages/Settings/formatters.ts',
]
  .map((f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf-8'))
  .join('\n');

describe('IP-012 — Urgent long articles are size-aware in shouldSkip', () => {
  it('URGENCY_KEYWORDS array still exists', () => {
    assert.match(preSummarizeSrc, /const URGENCY_KEYWORDS\s*=/);
  });

  it('shouldSkip has a token threshold at 2000 for urgent items', () => {
    assert.match(preSummarizeSrc, /2000/);
    assert.match(preSummarizeSrc, /isUrgent\s*&&\s*estimateTokens\(item\.content\)\s*<=\s*2000/);
  });

  it('urgent AND short items are skipped (return true)', () => {
    assert.match(
      preSummarizeSrc,
      /if\s*\(\s*isUrgent\s*&&\s*estimateTokens\(item\.content\)\s*<=\s*2000\s*\)\s*return\s+true/,
    );
  });

  it('urgent AND very long items fall through (no early return)', () => {
    // There must be a comment or logic indicating >8000 falls through
    // The code should NOT have a blanket "if (isUrgent) return true" without size check
    const blanketUrgentSkip = /if\s*\(\s*isUrgent\s*\)\s*return\s+true/.test(preSummarizeSrc);
    assert.equal(
      blanketUrgentSkip,
      false,
      'shouldSkip must NOT unconditionally skip all urgent items — long urgent items must fall through',
    );
  });
});

describe('DA-002 — StatusBadge uses stateStatus in Settings.tsx', () => {
  it('StatusBadge receives s.stateStatus as status prop', () => {
    // The JSX should pass stateStatus to StatusBadge
    assert.match(settingsSrc, /StatusBadge\s+status=\{s\.stateStatus/);
  });

  it('does NOT use s.status directly as StatusBadge prop', () => {
    // The old broken pattern: <StatusBadge status={s.status} />
    const brokenPattern = /StatusBadge\s+status=\{s\.status\s*\}/.test(settingsSrc);
    assert.equal(brokenPattern, false, 'StatusBadge must use s.stateStatus, not s.status directly');
  });
});
