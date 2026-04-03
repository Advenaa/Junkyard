/**
 * Cycle-110 structural regression tests.
 *
 * SC-012: refreshDailyCron builds config before stopping old cron
 * MG-013: schema_version SELECT uses ORDER BY DESC LIMIT 1
 *
 * Source-level pattern tests — read TypeScript source and assert structural
 * invariants. No runtime imports of the modules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schedulerSrc = readFileSync(
  new URL('../../src/scheduler.ts', import.meta.url), 'utf-8',
);

const migrationsSrc = readFileSync(
  new URL('../../src/db/migrations.ts', import.meta.url), 'utf-8',
);

// ── SC-012 — refreshDailyCron builds config before stopping old cron ─────

describe('SC-012: refreshDailyCron build-before-stop ordering', () => {
  // Extract the refreshDailyCron function body
  const fnMatch = schedulerSrc.match(
    /async function refreshDailyCron\b[\s\S]*?^\s{2}\}/m,
  );

  it('refreshDailyCron function exists', () => {
    assert.ok(fnMatch, 'refreshDailyCron function not found in scheduler.ts');
  });

  it('buildDailyCron() is called BEFORE dailyTask.stop()', () => {
    const body = fnMatch![0];
    const buildIdx = body.indexOf('buildDailyCron()');
    const stopIdx = body.indexOf('dailyTask.stop()');

    assert.ok(buildIdx !== -1, 'buildDailyCron() call not found in refreshDailyCron');
    assert.ok(stopIdx !== -1, 'dailyTask.stop() call not found in refreshDailyCron');
    assert.ok(
      buildIdx < stopIdx,
      `buildDailyCron() (pos ${buildIdx}) must appear before dailyTask.stop() (pos ${stopIdx})`,
    );
  });

  it('has shuttingDown guard', () => {
    const body = fnMatch![0];
    assert.ok(
      body.includes('shuttingDown'),
      'refreshDailyCron must check shuttingDown before proceeding',
    );
  });
});

// ── MG-013 — schema_version SELECT uses ORDER BY DESC LIMIT 1 ───────────

describe('MG-013: schema_version query uses ORDER BY DESC LIMIT 1', () => {
  // Find the SELECT from schema_version
  const selectMatch = migrationsSrc.match(
    /SELECT\s+version\s+FROM\s+schema_version\b[^`]*/i,
  );

  it('SELECT from schema_version exists', () => {
    assert.ok(selectMatch, 'SELECT version FROM schema_version not found in migrations.ts');
  });

  it('contains ORDER BY version DESC', () => {
    assert.ok(
      /ORDER\s+BY\s+version\s+DESC/i.test(selectMatch![0]),
      'schema_version query must include ORDER BY version DESC',
    );
  });

  it('contains LIMIT 1', () => {
    assert.ok(
      /LIMIT\s+1/i.test(selectMatch![0]),
      'schema_version query must include LIMIT 1',
    );
  });
});
