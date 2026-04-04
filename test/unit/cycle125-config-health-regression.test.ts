import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const serverSrc = readFileSync(new URL('../../src/server.ts', import.meta.url), 'utf-8');
const indexSrc = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf-8');
const healthSrc = readFileSync(new URL('../../src/health.ts', import.meta.url), 'utf-8');

describe('CF-010 — Config change triggers scheduler rebuild', () => {
  it('createServer signature includes onConfigChange parameter', () => {
    // Match the function signature with onConfigChange in the parameter list
    assert.ok(
      serverSrc.match(/export\s+async\s+function\s+createServer\b[\s\S]*?onConfigChange[\s\S]*?\)\s*:\s*Promise/),
      'createServer should accept an onConfigChange parameter',
    );
  });

  it('PATCH /config handler calls onConfigChange', () => {
    // The handler must invoke the callback
    assert.ok(
      serverSrc.includes('await onConfigChange()') || serverSrc.includes('onConfigChange()'),
      'PATCH /config handler should call onConfigChange()',
    );
  });

  it('onConfigChange is guarded by digest_time or timezone check', () => {
    // The call should only fire when schedule-relevant config keys change.
    // Look for a conditional that checks for digest_time or timezone before calling onConfigChange.
    const guardPattern = /onConfigChange\s*&&\s*\([^)]*(?:digest_time|timezone)[^)]*\)/;
    assert.ok(
      serverSrc.match(guardPattern),
      'onConfigChange call should be guarded by a digest_time or timezone condition',
    );
  });

  it('index.ts passes a callback that calls refreshDailyCron', () => {
    // The createServer call in index.ts should wire up scheduler.refreshDailyCron
    assert.ok(
      indexSrc.includes('refreshDailyCron'),
      'createServer call in index.ts should reference refreshDailyCron',
    );
    // Verify it's passed as an argument to createServer (call may contain nested parens)
    const callSite = indexSrc.match(/createServer\([\s\S]*?refreshDailyCron[\s\S]*?\);/);
    assert.ok(
      callSite,
      'refreshDailyCron should be passed within the createServer() call arguments',
    );
  });
});

describe('CF-011 — digest_time and timezone validated on PATCH', () => {
  it('digest_time format is validated with a regex', () => {
    // Should contain a regex that validates HH:MM format
    assert.ok(
      serverSrc.match(/digest_time[\s\S]{0,200}match\s*\(/) || serverSrc.match(/match\s*\([^)]*\\d[\s\S]*?\)/),
      'digest_time should be validated with a regex match',
    );
    // The regex should check for digit:digit pattern
    assert.ok(
      serverSrc.includes('\\d{1,2}') || serverSrc.includes('\\d{2}'),
      'digest_time regex should validate hour:minute digits',
    );
  });

  it('timezone is validated using Intl.DateTimeFormat', () => {
    assert.ok(
      serverSrc.includes('Intl.DateTimeFormat'),
      'timezone should be validated via Intl.DateTimeFormat',
    );
    // Confirm timeZone option is passed
    assert.ok(
      serverSrc.includes('timeZone'),
      'Intl.DateTimeFormat should receive the timezone value via timeZone option',
    );
  });

  it('both validations return 400 on failure', () => {
    // Extract the PATCH /config handler region (from the route registration to the next route)
    const patchStart = serverSrc.indexOf("app.patch('/api/v1/config'");
    assert.ok(patchStart !== -1, 'PATCH /api/v1/config route should exist');
    const patchRegion = serverSrc.slice(patchStart, patchStart + 2000);

    // Count 400 responses — should have at least 2 (one for digest_time, one for timezone)
    const code400Matches = patchRegion.match(/reply\.code\(400\)/g);
    assert.ok(
      code400Matches && code400Matches.length >= 2,
      'PATCH /config should return 400 for both digest_time and timezone validation failures',
    );
  });
});

describe('HM-020 — checkSourceSilence handles NULL last_fetched_at', () => {
  it('source silence query uses LEFT JOIN with source_state', () => {
    assert.ok(
      healthSrc.match(/LEFT\s+JOIN\s+source_state/i),
      'checkSourceSilence query should use LEFT JOIN (not INNER JOIN) with source_state',
    );
  });

  it('sources with NULL last_fetched_at are pushed to the silent array', () => {
    // The code should check for falsy last_fetched_at and push to silent, not skip with continue
    // Look for: if (!row.last_fetched_at) followed by silent.push, not continue
    const nullCheck = healthSrc.match(/if\s*\(\s*!row\.last_fetched_at\s*\)\s*\{[\s\S]*?silent\.push/);
    assert.ok(
      nullCheck,
      'Sources with NULL last_fetched_at should be pushed to the silent array',
    );

    // Ensure the null-check block does NOT just continue (skip the source)
    const nullBlock = healthSrc.match(/if\s*\(\s*!row\.last_fetched_at\s*\)\s*\{([^}]*)\}/);
    assert.ok(nullBlock, 'Should have a block handling null last_fetched_at');
    assert.ok(
      !nullBlock[1].match(/^\s*continue\s*;?\s*$/m) || nullBlock[1].includes('silent.push'),
      'NULL last_fetched_at block should push to silent, not just continue',
    );
  });

  it('HM-020 comment exists in the health check code', () => {
    assert.ok(
      healthSrc.includes('HM-020'),
      'health.ts should contain the HM-020 ticket reference comment',
    );
  });
});
