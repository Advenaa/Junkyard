import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSystemPrompt,
  hasShortDiscordSignalMarker,
  normalizeChunkSummaryCandidate,
  shouldFilterShortDiscordChunk,
  stripCodeFences,
  verifyEntities,
  verifyEvents,
  verifyRelationships,
} from '../../src/process/summarize.js';
import type { Logger } from '../../src/logger.js';
import { ChunkSummaryLLMSchema } from '../../src/process/schemas.js';
import type { ChunkSummary } from '../../src/process/schemas.js';

// ── Minimal logger stub (verifyEntities needs log.info) ──────────────

const noopLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  fatal: () => {},
  child: () => noopLog,
} as unknown as Logger;

// ── Helper to build a valid ChunkSummary with entity overrides ───────

function makeSummary(entities: ChunkSummary['entities']): ChunkSummary {
  return {
    summary: 'Test summary with enough characters to pass zod min(10).',
    urgency: 'routine',
    confidence: 7,
    entities,
    keyEvents: [],
    events: [],
    relationships: [],
    authorClaims: [],
  };
}

// ═════════════════════════════════════════════════════════════════════
// stripCodeFences
// ═════════════════════════════════════════════════════════════════════

describe('stripCodeFences', () => {
  it('removes ```json ... ``` wrapper', () => {
    const input = '```json\n{"a":1}\n```';
    assert.equal(stripCodeFences(input), '{"a":1}');
  });

  it('removes ``` ... ``` without language tag', () => {
    const input = '```\n{"b":2}\n```';
    assert.equal(stripCodeFences(input), '{"b":2}');
  });

  it('returns plain JSON as-is', () => {
    const input = '{"c":3}';
    assert.equal(stripCodeFences(input), '{"c":3}');
  });

  it('trims surrounding whitespace before checking fences', () => {
    const input = '  \n```json\n{"d":4}\n```\n  ';
    assert.equal(stripCodeFences(input), '{"d":4}');
  });

  it('does not strip fences that only appear in the middle', () => {
    const input = 'some text ```json block``` more text';
    assert.equal(stripCodeFences(input), 'some text ```json block``` more text');
  });

  it('handles content with internal newlines', () => {
    const input = '```json\n{\n  "key": "value"\n}\n```';
    assert.equal(stripCodeFences(input), '{\n  "key": "value"\n}');
  });
});

// ═════════════════════════════════════════════════════════════════════
// short Discord chunk filtering
// ═════════════════════════════════════════════════════════════════════

describe('shouldFilterShortDiscordChunk', () => {
  it('filters short low-information Discord chatter', () => {
    assert.equal(shouldFilterShortDiscordChunk('discord', [{ content: 'back to stone age' }]), true);
  });

  it('keeps short Discord messages that carry signal markers', () => {
    assert.equal(shouldFilterShortDiscordChunk('discord', [{ content: 'SEC sues Binance' }]), false);
    assert.equal(shouldFilterShortDiscordChunk('discord', [{ content: '$BTC exploit' }]), false);
  });

  it('does not apply the short-content guard to non-Discord sources', () => {
    assert.equal(shouldFilterShortDiscordChunk('twitter', [{ content: 'back to stone age' }]), false);
  });
});

describe('hasShortDiscordSignalMarker', () => {
  it('does not treat ordinary short chatter as ticker signal', () => {
    assert.equal(hasShortDiscordSignalMarker('lol gm to all'), false);
    assert.equal(hasShortDiscordSignalMarker('wtf was that trade'), false);
    assert.equal(hasShortDiscordSignalMarker('BTC moon'), false);
  });

  it('still matches dollar-prefixed tickers', () => {
    assert.equal(hasShortDiscordSignalMarker('$ETH pumping'), true);
    assert.equal(hasShortDiscordSignalMarker('$BTC just broke 100k'), true);
  });

  it('still matches numeric signal fallback without a dollar-prefixed ticker', () => {
    assert.equal(hasShortDiscordSignalMarker('BTC up 5%'), true);
  });
});

// ═════════════════════════════════════════════════════════════════════
// verifyEntities
// ═════════════════════════════════════════════════════════════════════

describe('verifyEntities', () => {
  it('keeps entity whose name appears in raw text', () => {
    const parsed = makeSummary([
      { name: 'Ethereum', aliases: ['ETH'], type: 'token', mentionCount: 3, sentiment: 0.5 },
    ]);
    const result = verifyEntities(parsed, 'People are talking about Ethereum today', noopLog, 'discord', 'chan1');
    assert.equal(result.entities.length, 1);
    assert.equal(result.entities[0].name, 'Ethereum');
  });

  it('keeps entity whose alias appears in raw text (H-016 fix)', () => {
    const parsed = makeSummary([
      { name: 'Ethereum', aliases: ['ETH', '$ETH'], type: 'token', mentionCount: 5, sentiment: 0.2 },
    ]);
    const result = verifyEntities(parsed, 'Just bought some ETH on the dip', noopLog, 'discord', 'chan1');
    assert.equal(result.entities.length, 1);
    assert.equal(result.entities[0].name, 'Ethereum');
  });

  it('drops entity whose name and aliases are absent from raw text', () => {
    const parsed = makeSummary([
      { name: 'Solana', aliases: ['SOL', '$SOL'], type: 'token', mentionCount: 2, sentiment: -0.1 },
    ]);
    const result = verifyEntities(parsed, 'Bitcoin is pumping hard right now', noopLog, 'discord', 'chan1');
    assert.equal(result.entities.length, 0);
  });

  it('returns empty entities when input entities array is empty', () => {
    const parsed = makeSummary([]);
    const result = verifyEntities(parsed, 'Some raw text here', noopLog, 'discord', 'chan1');
    assert.deepStrictEqual(result.entities, []);
  });

  it('matches case-insensitively', () => {
    const parsed = makeSummary([{ name: 'Bitcoin', aliases: ['BTC'], type: 'token', mentionCount: 1, sentiment: 0.3 }]);
    const result = verifyEntities(parsed, 'BITCOIN is king', noopLog, 'discord', 'chan1');
    assert.equal(result.entities.length, 1);
  });

  it('preserves non-entity fields of the summary', () => {
    const parsed = makeSummary([{ name: 'Ghost', aliases: [], type: 'project', mentionCount: 1, sentiment: 0 }]);
    parsed.urgency = 'breaking';
    parsed.confidence = 9;
    parsed.keyEvents = ['Something happened'];
    parsed.events = [{ entityName: 'Ghost', eventType: 'launch', description: 'Ghost launched a new feature.' }];
    const result = verifyEntities(parsed, 'No entities match here', noopLog, 'discord', 'chan1');
    assert.equal(result.urgency, 'breaking');
    assert.equal(result.confidence, 9);
    assert.deepStrictEqual(result.keyEvents, ['Something happened']);
    assert.deepStrictEqual(result.events, [
      { entityName: 'Ghost', eventType: 'launch', description: 'Ghost launched a new feature.' },
    ]);
    assert.equal(result.entities.length, 0);
  });

  it('filters mixed: keeps matching, drops non-matching', () => {
    const parsed = makeSummary([
      { name: 'Uniswap', aliases: ['UNI'], type: 'project', mentionCount: 10, sentiment: 0.4 },
      { name: 'Aave', aliases: ['AAVE'], type: 'project', mentionCount: 3, sentiment: 0.1 },
      { name: 'Phantom', aliases: [], type: 'project', mentionCount: 1, sentiment: 0 },
    ]);
    const result = verifyEntities(
      parsed,
      'Uniswap v4 hooks and AAVE lending pool discussion',
      noopLog,
      'discord',
      'chan1',
    );
    assert.equal(result.entities.length, 2);
    const names = result.entities.map((e) => e.name);
    assert.ok(names.includes('Uniswap'));
    assert.ok(names.includes('Aave'));
    assert.ok(!names.includes('Phantom'));
  });
});

describe('verifyEvents', () => {
  it('keeps events whose entityName matches a verified entity canonical name', () => {
    const parsed = makeSummary([
      { name: 'Wormhole', aliases: ['wormhole'], type: 'project', mentionCount: 3, sentiment: -0.8 },
    ]);
    parsed.events = [{ entityName: 'Wormhole', eventType: 'exploit', description: 'Wormhole bridge exploited.' }];
    const result = verifyEvents(parsed, noopLog, 'discord', 'chan1');
    assert.deepStrictEqual(result.events, parsed.events);
  });

  it('keeps events whose entityName matches a verified entity alias', () => {
    const parsed = makeSummary([
      { name: 'Ethereum', aliases: ['ETH', '$ETH'], type: 'token', mentionCount: 8, sentiment: 0.2 },
    ]);
    parsed.events = [
      { entityName: 'ETH', eventType: 'funding', description: 'ETH ecosystem funding round announced.' },
    ];
    const result = verifyEvents(parsed, noopLog, 'discord', 'chan1');
    assert.deepStrictEqual(result.events, parsed.events);
  });

  it('drops events whose entityName does not match any verified entity', () => {
    const parsed = makeSummary([{ name: 'Bitcoin', aliases: ['BTC'], type: 'token', mentionCount: 4, sentiment: 0.4 }]);
    parsed.events = [{ entityName: 'Wormhole', eventType: 'exploit', description: 'Wormhole exploited.' }];
    const result = verifyEvents(parsed, noopLog, 'discord', 'chan1');
    assert.deepStrictEqual(result.events, []);
  });
});

describe('verifyRelationships', () => {
  it('keeps relationships whose entities match verified canonical names', () => {
    const parsed = makeSummary([
      { name: 'Aave', aliases: ['AAVE'], type: 'project', mentionCount: 4, sentiment: 0.2 },
      { name: 'Compound', aliases: ['COMP'], type: 'project', mentionCount: 3, sentiment: -0.1 },
    ]);
    parsed.relationships = [
      { entityNameA: 'Aave', entityNameB: 'Compound', relationshipType: 'competes_with', confidence: 0.8 },
    ];
    const result = verifyRelationships(parsed, noopLog, 'discord', 'chan1');
    assert.deepStrictEqual(result.relationships, parsed.relationships);
  });

  it('drops relationships whose entities do not match verified entities', () => {
    const parsed = makeSummary([{ name: 'Bitcoin', aliases: ['BTC'], type: 'token', mentionCount: 4, sentiment: 0.4 }]);
    parsed.relationships = [
      { entityNameA: 'Bitcoin', entityNameB: 'Ethereum', relationshipType: 'competes_with', confidence: 0.7 },
    ];
    const result = verifyRelationships(parsed, noopLog, 'discord', 'chan1');
    assert.deepStrictEqual(result.relationships, []);
  });

  it('drops self-relationships and duplicate reversed pairs', () => {
    const parsed = makeSummary([
      { name: 'Arbitrum', aliases: ['ARB'], type: 'project', mentionCount: 2, sentiment: 0.1 },
      { name: 'Optimism', aliases: ['OP'], type: 'project', mentionCount: 2, sentiment: 0.1 },
    ]);
    parsed.relationships = [
      { entityNameA: 'Arbitrum', entityNameB: 'Arbitrum', relationshipType: 'competes_with', confidence: 0.9 },
      { entityNameA: 'Arbitrum', entityNameB: 'Optimism', relationshipType: 'competes_with', confidence: 0.8 },
      { entityNameA: 'Optimism', entityNameB: 'Arbitrum', relationshipType: 'competes_with', confidence: 0.8 },
    ];
    const result = verifyRelationships(parsed, noopLog, 'discord', 'chan1');
    assert.deepStrictEqual(result.relationships, [
      { entityNameA: 'Arbitrum', entityNameB: 'Optimism', relationshipType: 'competes_with', confidence: 0.8 },
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════
// buildSystemPrompt
// ═════════════════════════════════════════════════════════════════════

describe('buildSystemPrompt', () => {
  const prompt = buildSystemPrompt('discord', 'defi-general', 1700000000, 1700003600);

  it('includes the source and sourceId', () => {
    assert.ok(prompt.includes('discord'));
    assert.ok(prompt.includes('defi-general'));
  });

  it('includes the time window', () => {
    assert.ok(prompt.includes('1700000000'));
    assert.ok(prompt.includes('1700003600'));
  });

  it('contains urgency level definitions (H-013 few-shot)', () => {
    assert.ok(prompt.includes('"routine"'));
    assert.ok(prompt.includes('"elevated"'));
    assert.ok(prompt.includes('"breaking"'));
  });

  it('contains JSON schema description with entity fields', () => {
    assert.ok(prompt.includes('"name"'));
    assert.ok(prompt.includes('"aliases"'));
    assert.ok(prompt.includes('"type"'));
    assert.ok(prompt.includes('"mentionCount"'));
    assert.ok(prompt.includes('"sentiment"'));
    assert.ok(prompt.includes('"events"'));
    assert.ok(prompt.includes('"entityName"'));
    assert.ok(prompt.includes('"eventType"'));
    assert.ok(prompt.includes('"description"'));
    assert.ok(prompt.includes('"relationships"'));
    assert.ok(prompt.includes('"entityNameA"'));
    assert.ok(prompt.includes('"entityNameB"'));
    assert.ok(prompt.includes('"relationshipType"'));
    assert.ok(prompt.includes('"authorClaims"'));
    assert.ok(prompt.includes('"authorHandle"'));
    assert.ok(prompt.includes('"claimType"'));
    assert.ok(prompt.includes('"claimText"'));
  });

  it('contains few-shot examples (H-013 fix)', () => {
    assert.ok(prompt.includes('Example 1'));
    assert.ok(prompt.includes('Example 2'));
    assert.ok(prompt.includes('Uniswap v4 hook'));
    assert.ok(prompt.includes('Wormhole'));
  });

  it('instructs to return ONLY valid JSON', () => {
    assert.ok(prompt.includes('ONLY valid JSON'));
  });

  it('contains entity type enum values', () => {
    for (const t of ['token', 'person', 'project', 'company', 'event']) {
      assert.ok(prompt.includes(`"${t}"`), `missing type "${t}" in prompt`);
    }
  });

  it('contains structured event type enum values', () => {
    for (const t of ['exploit', 'audit', 'governance', 'launch', 'partnership', 'funding', 'hack', 'legal']) {
      assert.ok(prompt.includes(`"${t}"`) || prompt.includes(`"${t}`), `missing event type "${t}" in prompt`);
    }
  });

  it('contains relationship type enum values', () => {
    for (const t of [
      'competes_with',
      'built_on',
      'invested_in',
      'forked_from',
      'acquired',
      'founded',
      'advises',
      'partnered_with',
      'regulated_by',
    ]) {
      assert.ok(prompt.includes(`"${t}"`) || prompt.includes(`"${t}`), `missing relationship type "${t}" in prompt`);
    }
  });

  it('contains author claim type enum values', () => {
    for (const t of ['bullish', 'bearish', 'event', 'neutral']) {
      assert.ok(prompt.includes(`"${t}"`) || prompt.includes(`"${t}`), `missing author claim type "${t}" in prompt`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════
// ChunkSummaryLLMSchema (zod parse — proxy for parseWithZodRetry)
// ═════════════════════════════════════════════════════════════════════

describe('ChunkSummaryLLMSchema (zod validation)', () => {
  it('accepts valid input', () => {
    const input = {
      summary: 'A valid summary that is long enough to satisfy the min(10) constraint.',
      urgency: 'routine',
      confidence: 7,
      entities: [
        { name: 'Ethereum', aliases: ['ETH'], type: 'token', mentionCount: 5, sentiment: 0.3 },
        { name: 'Bitcoin', aliases: ['BTC'], type: 'token', mentionCount: 2, sentiment: 0.1 },
      ],
      keyEvents: ['Something happened'],
      events: [{ entityName: 'Ethereum', eventType: 'funding', description: 'Ethereum funding announced.' }],
      relationships: [
        {
          entityNameA: 'Ethereum',
          entityNameB: 'Bitcoin',
          relationshipType: 'competes_with',
          confidence: 0.6,
        },
      ],
      authorClaims: [
        {
          authorHandle: 'traderx',
          entityName: 'Ethereum',
          claimType: 'bullish',
          claimText: 'traderx said Ethereum looks ready to break higher.',
          confidence: 0.7,
        },
      ],
    };
    const result = ChunkSummaryLLMSchema.safeParse(input);
    assert.ok(result.success);
  });

  it('accepts all supported relationship types', () => {
    for (const relationshipType of [
      'competes_with',
      'built_on',
      'invested_in',
      'forked_from',
      'acquired',
      'founded',
      'advises',
      'partnered_with',
      'regulated_by',
    ] as const) {
      const result = ChunkSummaryLLMSchema.safeParse({
        summary: 'A valid summary that is long enough to satisfy the min(10) constraint.',
        urgency: 'routine',
        confidence: 7,
        entities: [
          { name: 'Ethereum', aliases: ['ETH'], type: 'token', mentionCount: 5, sentiment: 0.3 },
          { name: 'Bitcoin', aliases: ['BTC'], type: 'token', mentionCount: 4, sentiment: 0.1 },
        ],
        keyEvents: ['Something happened'],
        events: [],
        relationships: [
          {
            entityNameA: 'Ethereum',
            entityNameB: 'Bitcoin',
            relationshipType,
            confidence: 0.6,
          },
        ],
        authorClaims: [],
      });
      assert.ok(result.success, `expected relationship type "${relationshipType}" to parse`);
    }
  });

  it('accepts all supported author claim types', () => {
    for (const claimType of ['bullish', 'bearish', 'event', 'neutral'] as const) {
      const result = ChunkSummaryLLMSchema.safeParse({
        summary: 'A valid summary that is long enough to satisfy the min(10) constraint.',
        urgency: 'routine',
        confidence: 7,
        entities: [{ name: 'Ethereum', aliases: ['ETH'], type: 'token', mentionCount: 5, sentiment: 0.3 }],
        keyEvents: ['Something happened'],
        events: [],
        relationships: [],
        authorClaims: [
          {
            authorHandle: 'traderx',
            entityName: 'Ethereum',
            claimType,
            claimText: 'traderx posted a claim about Ethereum.',
            confidence: 0.6,
          },
        ],
      });
      assert.ok(result.success, `expected author claim type "${claimType}" to parse`);
    }
  });

  it('rejects summary shorter than 10 chars', () => {
    const input = {
      summary: 'Short',
      urgency: 'routine',
      confidence: 5,
    };
    const result = ChunkSummaryLLMSchema.safeParse(input);
    assert.ok(!result.success);
  });

  it('rejects invalid urgency value', () => {
    const input = {
      summary: 'A valid summary that is long enough.',
      urgency: 'critical',
      confidence: 5,
    };
    const result = ChunkSummaryLLMSchema.safeParse(input);
    assert.ok(!result.success);
  });

  it('rejects confidence outside 1-10 range', () => {
    const tooLow = {
      summary: 'A valid summary that is long enough.',
      urgency: 'routine',
      confidence: 0,
    };
    const tooHigh = {
      summary: 'A valid summary that is long enough.',
      urgency: 'routine',
      confidence: 11,
    };
    assert.ok(!ChunkSummaryLLMSchema.safeParse(tooLow).success);
    assert.ok(!ChunkSummaryLLMSchema.safeParse(tooHigh).success);
  });

  it('requires entity-linked extraction arrays to be present', () => {
    const input = {
      summary: 'A valid summary that is long enough.',
      urgency: 'routine',
      confidence: 5,
    };
    const result = ChunkSummaryLLMSchema.safeParse(input);
    assert.ok(!result.success);
    const paths = result.error!.issues.map((issue) => issue.path.join('.'));
    assert.ok(paths.includes('entities'));
    assert.ok(paths.includes('events'));
    assert.ok(paths.includes('relationships'));
    assert.ok(paths.includes('authorClaims'));
  });

  it('summarize-path normalization backfills omitted extraction arrays before schema validation', () => {
    const input = {
      summary: 'A valid summary that is long enough.',
      urgency: 'routine',
      confidence: 5,
    };
    const result = ChunkSummaryLLMSchema.safeParse(normalizeChunkSummaryCandidate(input));
    assert.ok(result.success);
    assert.deepStrictEqual(result.data.entities, []);
    assert.deepStrictEqual(result.data.events, []);
    assert.deepStrictEqual(result.data.relationships, []);
    assert.deepStrictEqual(result.data.authorClaims, []);
    assert.deepStrictEqual(result.data.keyEvents, []);
  });

  it('clamps entities array to max 20', () => {
    const entities = Array.from({ length: 21 }, (_, i) => ({
      name: `Entity${i}`,
      aliases: [],
      type: 'project' as const,
      mentionCount: 1,
      sentiment: 0,
    }));
    const input = {
      summary: 'A valid summary that is long enough.',
      urgency: 'routine',
      confidence: 5,
      entities,
      keyEvents: [],
    };
    const result = ChunkSummaryLLMSchema.safeParse(input);
    assert.ok(!result.success);
  });

  it('includes error paths on validation failure', () => {
    const input = {
      summary: 'A valid summary that is long enough.',
      urgency: 'bad',
      confidence: 5,
    };
    const result = ChunkSummaryLLMSchema.safeParse(input);
    assert.ok(!result.success);
    const paths = result.error!.issues.map((i) => i.path.join('.'));
    assert.ok(paths.some((p) => p === 'urgency'));
  });

  it('includes cross-field error paths for author claims that reference unknown entities', () => {
    const input = {
      summary: 'A valid summary that is long enough.',
      urgency: 'routine',
      confidence: 5,
      entities: [{ name: 'Ethereum', aliases: ['ETH'], type: 'token', mentionCount: 1, sentiment: 0.2 }],
      keyEvents: [],
      events: [],
      relationships: [],
      authorClaims: [
        {
          authorHandle: 'traderx',
          entityName: 'Solana',
          claimType: 'bullish',
          claimText: 'traderx posted a claim about Solana.',
          confidence: 0.6,
        },
      ],
    };
    const result = ChunkSummaryLLMSchema.safeParse(input);
    assert.ok(!result.success);
    const paths = result.error!.issues.map((issue) => issue.path.join('.'));
    assert.ok(paths.includes('authorClaims.0.entityName'));
  });
});

// ═════════════════════════════════════════════════════════════════════
// stripCodeFences + JSON.parse integration (simulates parseWithZodRetry first step)
// ═════════════════════════════════════════════════════════════════════

describe('stripCodeFences + JSON.parse (parse path)', () => {
  it('valid fenced JSON parses successfully', () => {
    const fenced = '```json\n{"summary":"Long enough summary text here.","urgency":"routine","confidence":5}\n```';
    const stripped = stripCodeFences(fenced);
    const parsed = JSON.parse(stripped);
    assert.equal(parsed.urgency, 'routine');
  });

  it('invalid JSON after stripping fences throws', () => {
    const fenced = '```json\n{not valid json}\n```';
    const stripped = stripCodeFences(fenced);
    assert.throws(() => JSON.parse(stripped));
  });
});
