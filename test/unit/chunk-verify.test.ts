import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyEntities, verifyEvents, verifyRelationships } from '../../src/process/chunk-verify.js';
import type { Logger } from '../../src/logger.js';
import type { ChunkSummary } from '../../src/process/schemas.js';

const noopLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  fatal: () => {},
  child: () => noopLog,
} as unknown as Logger;

function makeSummary(overrides: Partial<ChunkSummary> = {}): ChunkSummary {
  return {
    summary: 'Test summary with enough characters to satisfy the schema.',
    urgency: 'routine',
    confidence: 7,
    entities: [],
    keyEvents: [],
    events: [],
    relationships: [],
    authorClaims: [],
    ...overrides,
  };
}

describe('verifyEntities', () => {
  it('drops entities whose name and aliases are absent from the raw text', () => {
    const parsed = makeSummary({
      entities: [{ name: 'Solana', aliases: ['SOL', '$SOL'], type: 'token', mentionCount: 2, sentiment: 0.2 }],
    });

    const result = verifyEntities(
      parsed,
      'Bitcoin and Ethereum dominated the discussion.',
      noopLog,
      'discord',
      'chan1',
    );

    assert.deepStrictEqual(result.entities, []);
  });

  it('keeps entities whose alias matches with word boundaries case-insensitively', () => {
    const parsed = makeSummary({
      entities: [{ name: 'Ethereum', aliases: ['ETH', '$ETH'], type: 'token', mentionCount: 4, sentiment: 0.3 }],
    });

    const result = verifyEntities(parsed, 'Traders said eth held support overnight.', noopLog, 'discord', 'chan1');

    assert.deepStrictEqual(result.entities, parsed.entities);
  });

  it('does not match partial words', () => {
    const parsed = makeSummary({
      entities: [{ name: 'Bitcoin', aliases: ['BTC'], type: 'token', mentionCount: 5, sentiment: 0.1 }],
    });

    const result = verifyEntities(
      parsed,
      'The room was joking about bitcoinized treasury companies.',
      noopLog,
      'discord',
      'chan1',
    );

    assert.deepStrictEqual(result.entities, []);
  });

  it('passes through an all-verified parsed result unchanged', () => {
    const parsed = makeSummary({
      urgency: 'breaking',
      confidence: 9,
      entities: [
        { name: 'Wormhole', aliases: ['wormhole'], type: 'project', mentionCount: 6, sentiment: -0.9 },
        { name: 'Ethereum', aliases: ['ETH'], type: 'token', mentionCount: 3, sentiment: -0.1 },
      ],
      keyEvents: ['Wormhole paused bridge operations after the exploit.'],
      events: [{ entityName: 'Wormhole', eventType: 'exploit', description: 'Wormhole bridge exploited.' }],
      relationships: [
        { entityNameA: 'Wormhole', entityNameB: 'Ethereum', relationshipType: 'built_on', confidence: 0.4 },
      ],
      authorClaims: [
        {
          authorHandle: 'bridgewatch',
          entityName: 'Wormhole',
          claimType: 'event',
          claimText: 'bridgewatch said Wormhole paused the bridge.',
          confidence: 0.8,
        },
      ],
    });

    const result = verifyEntities(
      parsed,
      'Wormhole suffered an exploit while ETH traders watched the bridge pause.',
      noopLog,
      'discord',
      'chan1',
    );

    assert.deepStrictEqual(result, parsed);
  });
});

describe('verifyEvents', () => {
  it('drops events whose entityName is not in the verified entity set', () => {
    const parsed = makeSummary({
      entities: [{ name: 'Bitcoin', aliases: ['BTC'], type: 'token', mentionCount: 4, sentiment: 0.4 }],
      events: [{ entityName: 'Solana', eventType: 'launch', description: 'Solana launched a new product.' }],
    });

    const result = verifyEvents(parsed, noopLog, 'discord', 'chan1');

    assert.deepStrictEqual(result.events, []);
  });

  it('keeps events whose entityName matches a canonical entity name', () => {
    const parsed = makeSummary({
      entities: [{ name: 'Wormhole', aliases: ['wormhole'], type: 'project', mentionCount: 3, sentiment: -0.8 }],
      events: [{ entityName: 'Wormhole', eventType: 'exploit', description: 'Wormhole bridge exploited.' }],
    });

    const result = verifyEvents(parsed, noopLog, 'discord', 'chan1');

    assert.deepStrictEqual(result.events, parsed.events);
  });

  it('keeps events whose entityName matches through an alias', () => {
    const parsed = makeSummary({
      entities: [{ name: 'Ethereum', aliases: ['ETH', '$ETH'], type: 'token', mentionCount: 8, sentiment: 0.2 }],
      events: [{ entityName: 'eth', eventType: 'funding', description: 'ETH ecosystem funding round announced.' }],
    });

    const result = verifyEvents(parsed, noopLog, 'discord', 'chan1');

    assert.deepStrictEqual(result.events, parsed.events);
  });

  it('passes through an all-verified set unchanged', () => {
    const parsed = makeSummary({
      entities: [{ name: 'Aave', aliases: ['AAVE'], type: 'project', mentionCount: 5, sentiment: 0.3 }],
      events: [{ entityName: 'AAVE', eventType: 'governance', description: 'Aave governance vote opened.' }],
    });

    const result = verifyEvents(parsed, noopLog, 'discord', 'chan1');

    assert.deepStrictEqual(result, parsed);
  });
});

describe('verifyRelationships', () => {
  it('drops relationships where either endpoint is not a verified entity', () => {
    const parsed = makeSummary({
      entities: [{ name: 'Aave', aliases: ['AAVE'], type: 'project', mentionCount: 4, sentiment: 0.2 }],
      relationships: [
        { entityNameA: 'Aave', entityNameB: 'Compound', relationshipType: 'competes_with', confidence: 0.8 },
      ],
    });

    const result = verifyRelationships(parsed, noopLog, 'discord', 'chan1');

    assert.deepStrictEqual(result.relationships, []);
  });

  it('drops relationships where entityNameA === entityNameB after normalization', () => {
    const parsed = makeSummary({
      entities: [{ name: 'Ethereum', aliases: ['ETH', '$ETH'], type: 'token', mentionCount: 6, sentiment: 0.2 }],
      relationships: [{ entityNameA: 'ETH', entityNameB: '$ETH', relationshipType: 'competes_with', confidence: 0.6 }],
    });

    const result = verifyRelationships(parsed, noopLog, 'discord', 'chan1');

    assert.deepStrictEqual(result.relationships, []);
  });

  it('deduplicates symmetric relationships by canonical pair and relationship type', () => {
    const parsed = makeSummary({
      entities: [
        { name: 'Arbitrum', aliases: ['ARB'], type: 'project', mentionCount: 4, sentiment: 0.1 },
        { name: 'Optimism', aliases: ['OP'], type: 'project', mentionCount: 4, sentiment: 0.1 },
      ],
      relationships: [
        { entityNameA: 'Arbitrum', entityNameB: 'Optimism', relationshipType: 'competes_with', confidence: 0.8 },
        { entityNameA: 'Optimism', entityNameB: 'Arbitrum', relationshipType: 'competes_with', confidence: 0.7 },
      ],
    });

    const result = verifyRelationships(parsed, noopLog, 'discord', 'chan1');

    assert.deepStrictEqual(result.relationships, [parsed.relationships[0]]);
  });

  it('passes through distinct verified pairs unchanged', () => {
    const parsed = makeSummary({
      entities: [
        { name: 'Aave', aliases: ['AAVE'], type: 'project', mentionCount: 4, sentiment: 0.2 },
        { name: 'Chainlink', aliases: ['LINK'], type: 'project', mentionCount: 3, sentiment: 0.3 },
        { name: 'Ethereum', aliases: ['ETH'], type: 'token', mentionCount: 5, sentiment: 0.1 },
      ],
      relationships: [
        { entityNameA: 'AAVE', entityNameB: 'LINK', relationshipType: 'partnered_with', confidence: 0.7 },
        { entityNameA: 'Chainlink', entityNameB: 'Ethereum', relationshipType: 'built_on', confidence: 0.4 },
      ],
    });

    const result = verifyRelationships(parsed, noopLog, 'discord', 'chan1');

    assert.deepStrictEqual(result, parsed);
  });
});
