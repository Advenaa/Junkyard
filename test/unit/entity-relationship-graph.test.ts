import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getEntityRelationshipGraph } from '../../src/db/queries.js';

describe('entity relationship graph query', () => {
  it('builds a bounded two-hop neighborhood rooted at the selected entity', async () => {
    const pool = {
      calls: [] as Array<{ text: string; values: unknown[] }>,
      query: async (text: string, values?: unknown[]) => {
        pool.calls.push({ text, values: values ?? [] });

        if (text.includes('FROM entities') && text.includes('WHERE id = $1')) {
          return { rows: [{ id: 'ent-eth', name: 'Ethereum' }], rowCount: 1 };
        }

        if (text.includes('ANY($1::text[])')) {
          const entityIds = values?.[0] as string[];
          if (entityIds.includes('ent-eth')) {
            return {
              rows: [
                {
                  id: 'rel-1',
                  entityIdA: 'ent-eth',
                  entityNameA: 'Ethereum',
                  entityIdB: 'ent-sol',
                  entityNameB: 'Solana',
                  relationshipType: 'competes_with',
                  confidence: 0.88,
                  source: 'manual',
                  summaryId: null,
                  sinceAt: null,
                  untilAt: null,
                  createdAt: 1,
                  updatedAt: 5,
                },
                {
                  id: 'rel-2',
                  entityIdA: 'ent-arb',
                  entityNameA: 'Arbitrum',
                  entityIdB: 'ent-eth',
                  entityNameB: 'Ethereum',
                  relationshipType: 'built_on',
                  confidence: 0.72,
                  source: 'llm_inferred',
                  summaryId: 'sum-1',
                  sinceAt: null,
                  untilAt: null,
                  createdAt: 2,
                  updatedAt: 4,
                },
              ],
              rowCount: 2,
            };
          }

          return {
            rows: [
              {
                id: 'rel-1',
                entityIdA: 'ent-eth',
                entityNameA: 'Ethereum',
                entityIdB: 'ent-sol',
                entityNameB: 'Solana',
                relationshipType: 'competes_with',
                confidence: 0.88,
                source: 'manual',
                summaryId: null,
                sinceAt: null,
                untilAt: null,
                createdAt: 1,
                updatedAt: 5,
              },
              {
                id: 'rel-2',
                entityIdA: 'ent-arb',
                entityNameA: 'Arbitrum',
                entityIdB: 'ent-eth',
                entityNameB: 'Ethereum',
                relationshipType: 'built_on',
                confidence: 0.72,
                source: 'llm_inferred',
                summaryId: 'sum-1',
                sinceAt: null,
                untilAt: null,
                createdAt: 2,
                updatedAt: 4,
              },
              {
                id: 'rel-3',
                entityIdA: 'ent-sol',
                entityNameA: 'Solana',
                entityIdB: 'ent-base',
                entityNameB: 'Base',
                relationshipType: 'built_on',
                confidence: 0.65,
                source: 'manual',
                summaryId: null,
                sinceAt: null,
                untilAt: null,
                createdAt: 3,
                updatedAt: 6,
              },
              {
                id: 'rel-4',
                entityIdA: 'ent-op',
                entityNameA: 'Optimism',
                entityIdB: 'ent-arb',
                entityNameB: 'Arbitrum',
                relationshipType: 'competes_with',
                confidence: 0.61,
                source: 'manual',
                summaryId: null,
                sinceAt: null,
                untilAt: null,
                createdAt: 4,
                updatedAt: 3,
              },
            ],
            rowCount: 4,
          };
        }

        return { rows: [], rowCount: 0 };
      },
    };

    const graph = await getEntityRelationshipGraph(pool as never, 'ent-eth', 2, 8);

    assert.ok(graph);
    assert.equal(graph.rootEntityId, 'ent-eth');
    assert.deepEqual(
      graph.nodes.map((node) => ({ id: node.id, depth: node.depth })),
      [
        { id: 'ent-eth', depth: 0 },
        { id: 'ent-arb', depth: 1 },
        { id: 'ent-sol', depth: 1 },
        { id: 'ent-base', depth: 2 },
        { id: 'ent-op', depth: 2 },
      ],
    );
    assert.deepEqual(graph.relationships.map((relationship) => relationship.id).sort(), [
      'rel-1',
      'rel-2',
      'rel-3',
      'rel-4',
    ]);
  });

  it('returns null when the root entity does not exist', async () => {
    const pool = {
      query: async (text: string) => {
        if (text.includes('FROM entities')) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error('Unexpected relationship lookup for missing root');
      },
    };

    const graph = await getEntityRelationshipGraph(pool as never, 'missing-entity', 2, 8);
    assert.equal(graph, null);
  });
});
