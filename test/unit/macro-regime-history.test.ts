import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMacroRegimeHistoryByReport } from '../../src/db/queries.js';
import { readServerSource } from './helpers/server-source.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

function mockPool(responses: Array<{ rows?: unknown[]; rowCount?: number }>) {
  let callIndex = 0;
  return {
    query: async () => {
      const response = responses[callIndex] ?? { rows: [], rowCount: 0 };
      callIndex += 1;
      return { rows: response.rows ?? [], rowCount: response.rowCount ?? 0 };
    },
  };
}

describe('getMacroRegimeHistoryByReport', () => {
  it('returns null when the report has no persisted macro regime row', async () => {
    const pool = mockPool([{ rows: [] }]);
    const result = await getMacroRegimeHistoryByReport(pool as never, 'report-1');
    assert.equal(result, null);
  });

  it('computes the current streak and previous classification for consecutive daily rows', async () => {
    const pool = mockPool([
      {
        rows: [
          {
            id: 'regime-1',
            report_id: 'report-1',
            date: '2026-04-08',
            report_type: 'daily',
            classification: 'risk-off',
            confidence: 0.82,
            rationale: 'Risk assets remained under pressure.',
            created_at: 1,
          },
        ],
      },
      {
        rows: [
          { date: '2026-04-08', classification: 'risk-off' },
          { date: '2026-04-07', classification: 'risk-off' },
          { date: '2026-04-06', classification: 'risk-off' },
          { date: '2026-04-05', classification: 'risk-on' },
        ],
      },
    ]);

    const result = await getMacroRegimeHistoryByReport(pool as never, 'report-1');

    assert.deepStrictEqual(result, {
      streakDays: 3,
      regimeStartedAt: '2026-04-06',
      previousClassification: 'risk-on',
    });
  });

  it('stops the streak when there is a date gap', async () => {
    const pool = mockPool([
      {
        rows: [
          {
            id: 'regime-1',
            report_id: 'report-1',
            date: '2026-04-08',
            report_type: 'daily',
            classification: 'transition',
            confidence: 0.61,
            rationale: 'Tape is mixed.',
            created_at: 1,
          },
        ],
      },
      {
        rows: [
          { date: '2026-04-08', classification: 'transition' },
          { date: '2026-04-06', classification: 'transition' },
        ],
      },
    ]);

    const result = await getMacroRegimeHistoryByReport(pool as never, 'report-1');

    assert.deepStrictEqual(result, {
      streakDays: 1,
      regimeStartedAt: '2026-04-08',
      previousClassification: null,
    });
  });
});

describe('Macro regime history structure', () => {
  const migrations = readSrc('src/db/migrations.ts');
  const synth = readSrc('src/process/synthesize.ts') + '\n' + readSrc('src/process/synthesis-context.ts');
  const server = readServerSource();

  it('migration 32 creates macro_regimes table with a unique report_id', () => {
    assert.ok(migrations.includes('CREATE TABLE IF NOT EXISTS macro_regimes'));
    assert.match(migrations, /report_id TEXT NOT NULL UNIQUE REFERENCES reports\(id\)/);
  });

  it('runDaily persists macro regime history after report creation', () => {
    assert.ok(synth.includes('insertMacroRegime'));
    assert.match(synth, /if \(report\.macroRegime\)/);
    assert.match(synth, /reportType: 'daily'/);
  });

  it('reports/:id exposes macroRegimeHistory when persisted history exists', () => {
    assert.ok(server.includes('report.macroRegimeHistory'));
    assert.ok(server.includes('getMacroRegimeHistoryByReport'));
  });
});
