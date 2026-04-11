import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const skill = readFileSync(resolve(ROOT, '.claude/skills/scout/SKILL.md'), 'utf-8');

const requiredSubstrings = [
  '/scout runtime',
  'PODDERS_DIAG_BASE_URL',
  'PODDERS_DIAG_ADMIN_TOKEN',
  '/api/v1/diag/stuck-items',
  '/api/v1/diag/backpressure',
  '/api/v1/diag/halted-sources',
  '/api/v1/diag/health-events',
  'scout-runtime-',
  '1 p0, 3 p1, 8 p2',
  'stuckCount > 0',
  'readyCount > 1000',
] as const;

describe('scout runtime audit doc regression', () => {
  for (const substring of requiredSubstrings) {
    it(`includes ${substring}`, () => {
      assert.ok(skill.includes(substring), `Expected .claude/skills/scout/SKILL.md to include ${substring}`);
    });
  }
});
