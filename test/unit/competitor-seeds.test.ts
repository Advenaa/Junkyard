import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSeeder } from '../../src/knowledge/seed.js';

const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => silentLog,
} as never;

describe('competitor seed runner', () => {
  it('upserts manual competitor relationships for resolved entity pairs', async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const pool = {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values: values ?? [] });

        if (text.includes('SELECT id, LOWER(name) AS lookup_key')) {
          return {
            rows: [
              { id: 'ent-aave', lookup_key: 'aave' },
              { id: 'ent-compound', lookup_key: 'compound' },
              { id: 'ent-makerdao', lookup_key: 'makerdao' },
            ],
            rowCount: 3,
          };
        }

        if (text.includes('SELECT DISTINCT ON (ea.alias)')) {
          return { rows: [], rowCount: 0 };
        }

        if (text.includes('INSERT INTO entity_relationships')) {
          return { rows: [], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      },
    };

    const seeder = createSeeder(pool as never, silentLog);
    const seeded = await seeder.seedCompetitorRelationships();

    assert.equal(seeded, 2);
    const relationshipWrites = calls.filter((call) => call.text.includes('INSERT INTO entity_relationships'));
    assert.equal(relationshipWrites.length, 2);
    assert.equal(relationshipWrites[0]!.values[3], 'competes_with');
    assert.equal(relationshipWrites[0]!.values[4], 0.85);
    assert.equal(relationshipWrites[0]!.values[5], 'manual');
  });

  it('falls back to alias matches for unresolved exact names', async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const pool = {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values: values ?? [] });

        if (text.includes('SELECT id, LOWER(name) AS lookup_key')) {
          return { rows: [], rowCount: 0 };
        }

        if (text.includes('SELECT DISTINCT ON (ea.alias)')) {
          return {
            rows: [
              { id: 'ent-usdc', lookup_key: 'usdc' },
              { id: 'ent-tether', lookup_key: 'tether' },
            ],
            rowCount: 2,
          };
        }

        if (text.includes('INSERT INTO entity_relationships')) {
          return { rows: [], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      },
    };

    const seeder = createSeeder(pool as never, silentLog);
    const seeded = await seeder.seedCompetitorRelationships();

    assert.equal(seeded, 1);
    const relationshipWrite = calls.find(
      (call) =>
        call.text.includes('INSERT INTO entity_relationships') &&
        call.values[1] === 'ent-tether' &&
        call.values[2] === 'ent-usdc',
    );
    assert.ok(relationshipWrite, 'Expected Tether/USDC seed to use alias-based entity resolution');
  });
});
