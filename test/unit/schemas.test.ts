import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChunkSummaryLLMSchema, MarketReportLLMSchema } from '../../src/process/schemas.js';

/* ------------------------------------------------------------------ */
/*  ChunkSummaryLLMSchema                                             */
/* ------------------------------------------------------------------ */

describe('ChunkSummaryLLMSchema', () => {
  const validChunk = {
    summary: 'A valid summary that is long enough',
    urgency: 'routine' as const,
    confidence: 5,
    entities: [
      {
        name: 'Bitcoin',
        aliases: ['BTC'],
        type: 'token' as const,
        mentionCount: 3,
        sentiment: 0.5,
      },
    ],
    keyEvents: ['Price surged past $100k'],
    events: [{ entityName: 'Bitcoin', eventType: 'launch' as const, description: 'Bitcoin product launch discussed.' }],
    relationships: [],
    authorClaims: [],
  };

  it('accepts valid input', () => {
    const result = ChunkSummaryLLMSchema.parse(validChunk);
    assert.equal(result.summary, validChunk.summary);
    assert.equal(result.urgency, 'routine');
    assert.equal(result.confidence, 5);
  });

  it('fails when summary is missing', () => {
    const { summary, ...rest } = validChunk;
    assert.throws(() => ChunkSummaryLLMSchema.parse(rest));
  });

  it('fails when urgency is missing', () => {
    const { urgency, ...rest } = validChunk;
    assert.throws(() => ChunkSummaryLLMSchema.parse(rest));
  });

  it('fails when confidence is missing', () => {
    const { confidence, ...rest } = validChunk;
    assert.throws(() => ChunkSummaryLLMSchema.parse(rest));
  });

  it('fails when summary is too short (< 10 chars)', () => {
    assert.throws(() => ChunkSummaryLLMSchema.parse({ ...validChunk, summary: 'short' }));
  });

  /* -- Sentiment boundaries -- */

  it('sentiment -1 passes', () => {
    const input = {
      ...validChunk,
      entities: [{ name: 'X', sentiment: -1 }],
      events: [],
    };
    const result = ChunkSummaryLLMSchema.parse(input);
    assert.equal(result.entities[0].sentiment, -1);
  });

  it('sentiment 1 passes', () => {
    const input = {
      ...validChunk,
      entities: [{ name: 'X', sentiment: 1 }],
      events: [],
    };
    const result = ChunkSummaryLLMSchema.parse(input);
    assert.equal(result.entities[0].sentiment, 1);
  });

  it('sentiment -1.001 fails', () => {
    assert.throws(() =>
      ChunkSummaryLLMSchema.parse({
        ...validChunk,
        entities: [{ name: 'X', sentiment: -1.001 }],
        events: [],
      }),
    );
  });

  it('sentiment 1.001 fails', () => {
    assert.throws(() =>
      ChunkSummaryLLMSchema.parse({
        ...validChunk,
        entities: [{ name: 'X', sentiment: 1.001 }],
        events: [],
      }),
    );
  });

  /* -- Confidence boundaries -- */

  it('confidence 1 passes', () => {
    const result = ChunkSummaryLLMSchema.parse({
      ...validChunk,
      confidence: 1,
    });
    assert.equal(result.confidence, 1);
  });

  it('confidence 10 passes', () => {
    const result = ChunkSummaryLLMSchema.parse({
      ...validChunk,
      confidence: 10,
    });
    assert.equal(result.confidence, 10);
  });

  it('confidence 0 fails', () => {
    assert.throws(() => ChunkSummaryLLMSchema.parse({ ...validChunk, confidence: 0 }));
  });

  it('confidence 11 fails', () => {
    assert.throws(() => ChunkSummaryLLMSchema.parse({ ...validChunk, confidence: 11 }));
  });

  /* -- Entity array max -- */

  it('20 entities passes', () => {
    const entities = Array.from({ length: 20 }, (_, i) => ({
      name: `Entity${i}`,
    }));
    const result = ChunkSummaryLLMSchema.parse({
      ...validChunk,
      entities,
      events: [],
    });
    assert.equal(result.entities.length, 20);
  });

  it('21 entities fails', () => {
    const entities = Array.from({ length: 21 }, (_, i) => ({
      name: `Entity${i}`,
    }));
    assert.throws(() => ChunkSummaryLLMSchema.parse({ ...validChunk, entities, events: [] }));
  });

  /* -- keyEvents max (5 for chunk) -- */

  it('5 keyEvents passes', () => {
    const keyEvents = Array.from({ length: 5 }, (_, i) => `Event ${i}`);
    const result = ChunkSummaryLLMSchema.parse({
      ...validChunk,
      keyEvents,
    });
    assert.equal(result.keyEvents.length, 5);
  });

  it('6 keyEvents fails', () => {
    const keyEvents = Array.from({ length: 6 }, (_, i) => `Event ${i}`);
    assert.throws(() => ChunkSummaryLLMSchema.parse({ ...validChunk, keyEvents }));
  });

  it('5 events pass', () => {
    const entities = Array.from({ length: 5 }, (_, i) => ({
      name: `Entity${i}`,
    }));
    const events = Array.from({ length: 5 }, (_, i) => ({
      entityName: `Entity${i}`,
      eventType: 'launch' as const,
      description: `Launch event ${i}`,
    }));
    const result = ChunkSummaryLLMSchema.parse({
      ...validChunk,
      entities,
      events,
    });
    assert.equal(result.events.length, 5);
  });

  it('6 events fail', () => {
    const entities = Array.from({ length: 6 }, (_, i) => ({
      name: `Entity${i}`,
    }));
    const events = Array.from({ length: 6 }, (_, i) => ({
      entityName: `Entity${i}`,
      eventType: 'launch' as const,
      description: `Launch event ${i}`,
    }));
    assert.throws(() => ChunkSummaryLLMSchema.parse({ ...validChunk, entities, events }));
  });

  /* -- Default values -- */

  it('fails when entities are omitted', () => {
    const { entities, ...rest } = validChunk;
    assert.throws(() => ChunkSummaryLLMSchema.parse(rest));
  });

  it('defaults keyEvents to [] when omitted', () => {
    const { keyEvents, ...rest } = validChunk;
    const result = ChunkSummaryLLMSchema.parse(rest);
    assert.deepStrictEqual(result.keyEvents, []);
  });

  it('fails when events are omitted', () => {
    const { events, ...rest } = validChunk;
    assert.throws(() => ChunkSummaryLLMSchema.parse(rest));
  });

  it('fails when relationships are omitted', () => {
    const { relationships, ...rest } = validChunk;
    assert.throws(() => ChunkSummaryLLMSchema.parse(rest));
  });

  it('fails when authorClaims are omitted', () => {
    const { authorClaims, ...rest } = validChunk;
    assert.throws(() => ChunkSummaryLLMSchema.parse(rest));
  });

  it('defaults entity type to "project" when omitted', () => {
    const input = {
      ...validChunk,
      entities: [{ name: 'SomeProject', sentiment: 0.2 }],
      events: [],
    };
    const result = ChunkSummaryLLMSchema.parse(input);
    assert.equal(result.entities[0].type, 'project');
  });

  it('defaults entity aliases to [] when omitted', () => {
    const input = {
      ...validChunk,
      entities: [{ name: 'X' }],
      events: [],
    };
    const result = ChunkSummaryLLMSchema.parse(input);
    assert.deepStrictEqual(result.entities[0].aliases, []);
  });

  it('defaults entity mentionCount to 1 when omitted', () => {
    const input = {
      ...validChunk,
      entities: [{ name: 'X' }],
      events: [],
    };
    const result = ChunkSummaryLLMSchema.parse(input);
    assert.equal(result.entities[0].mentionCount, 1);
  });

  it('defaults entity sentiment to 0 when omitted', () => {
    const input = {
      ...validChunk,
      entities: [{ name: 'X' }],
      events: [],
    };
    const result = ChunkSummaryLLMSchema.parse(input);
    assert.equal(result.entities[0].sentiment, 0);
  });

  it('fails when an event entity is not declared in entities', () => {
    assert.throws(() =>
      ChunkSummaryLLMSchema.parse({
        ...validChunk,
        events: [{ entityName: 'Ethereum', eventType: 'launch', description: 'Ethereum launch event discussed.' }],
      }),
    );
  });

  it('accepts events that reference a declared entity alias', () => {
    const result = ChunkSummaryLLMSchema.parse({
      ...validChunk,
      entities: [{ name: 'Ethereum', aliases: ['ETH'] }],
      events: [{ entityName: 'ETH', eventType: 'launch', description: 'Ethereum launch event discussed.' }],
    });
    assert.equal(result.events[0].entityName, 'ETH');
  });

  it('fails when an author claim entity is not declared in entities', () => {
    assert.throws(() =>
      ChunkSummaryLLMSchema.parse({
        ...validChunk,
        authorClaims: [
          {
            authorHandle: 'traderx',
            entityName: 'Solana',
            claimType: 'bullish',
            claimText: 'traderx said Solana looked strong.',
          },
        ],
      }),
    );
  });

  it('fails when a relationship references the same entity twice', () => {
    assert.throws(() =>
      ChunkSummaryLLMSchema.parse({
        ...validChunk,
        relationships: [
          {
            entityNameA: 'Bitcoin',
            entityNameB: 'Bitcoin',
            relationshipType: 'competes_with',
          },
        ],
      }),
    );
  });
});

/* ------------------------------------------------------------------ */
/*  MarketReportLLMSchema                                             */
/* ------------------------------------------------------------------ */

describe('MarketReportLLMSchema', () => {
  const validReport = {
    tldr: 'Markets are calm today with minor movements across major tokens.',
    keyEvents: ['Fed held rates steady'],
    marketCatalysts: ['Friday options expiry could raise BTC vol.'],
    eventChains: ['Bitcoin exploit chain: exploit -> audit -> governance (3 linked events).'],
    entitySentiment: [{ name: 'Bitcoin', sentiment: 0.3, reason: 'Slow grind up' }],
    sections: [{ title: 'Overview', body: 'All quiet.' }],
    newProjects: [{ name: 'CoolDAO', description: 'A new DAO project' }],
  };

  it('accepts valid input', () => {
    const result = MarketReportLLMSchema.parse(validReport);
    assert.equal(result.tldr, validReport.tldr);
  });

  it('fails when tldr is missing', () => {
    const { tldr, ...rest } = validReport;
    assert.throws(() => MarketReportLLMSchema.parse(rest));
  });

  it('fails when tldr exceeds 500 chars', () => {
    assert.throws(() =>
      MarketReportLLMSchema.parse({
        ...validReport,
        tldr: 'x'.repeat(501),
      }),
    );
  });

  it('fails when tldr is blank after trimming', () => {
    assert.throws(() =>
      MarketReportLLMSchema.parse({
        ...validReport,
        tldr: '   ',
      }),
    );
  });

  /* -- Sentiment boundaries on entitySentiment -- */

  it('entitySentiment sentiment -1 passes', () => {
    const result = MarketReportLLMSchema.parse({
      ...validReport,
      entitySentiment: [{ name: 'X', sentiment: -1, reason: 'bad' }],
    });
    assert.equal(result.entitySentiment[0].sentiment, -1);
  });

  it('entitySentiment sentiment 1 passes', () => {
    const result = MarketReportLLMSchema.parse({
      ...validReport,
      entitySentiment: [{ name: 'X', sentiment: 1, reason: 'good' }],
    });
    assert.equal(result.entitySentiment[0].sentiment, 1);
  });

  it('entitySentiment sentiment -1.001 fails', () => {
    assert.throws(() =>
      MarketReportLLMSchema.parse({
        ...validReport,
        entitySentiment: [{ name: 'X', sentiment: -1.001, reason: 'bad' }],
      }),
    );
  });

  it('entitySentiment sentiment 1.001 fails', () => {
    assert.throws(() =>
      MarketReportLLMSchema.parse({
        ...validReport,
        entitySentiment: [{ name: 'X', sentiment: 1.001, reason: 'good' }],
      }),
    );
  });

  /* -- keyEvents max (10 for report) -- */

  it('10 keyEvents passes', () => {
    const keyEvents = Array.from({ length: 10 }, (_, i) => `Event ${i}`);
    const result = MarketReportLLMSchema.parse({
      ...validReport,
      keyEvents,
    });
    assert.equal(result.keyEvents.length, 10);
  });

  it('11 keyEvents fails', () => {
    const keyEvents = Array.from({ length: 11 }, (_, i) => `Event ${i}`);
    assert.throws(() => MarketReportLLMSchema.parse({ ...validReport, keyEvents }));
  });

  it('fails when keyEvents contains a blank string', () => {
    assert.throws(() =>
      MarketReportLLMSchema.parse({
        ...validReport,
        keyEvents: ['Fed held rates steady', '   '],
      }),
    );
  });

  it('6 marketCatalysts pass', () => {
    const marketCatalysts = Array.from({ length: 6 }, (_, i) => `Catalyst ${i}`);
    const result = MarketReportLLMSchema.parse({
      ...validReport,
      marketCatalysts,
    });
    assert.equal(result.marketCatalysts.length, 6);
  });

  it('7 marketCatalysts fail', () => {
    const marketCatalysts = Array.from({ length: 7 }, (_, i) => `Catalyst ${i}`);
    assert.throws(() => MarketReportLLMSchema.parse({ ...validReport, marketCatalysts }));
  });

  it('fails when marketCatalysts contains a whitespace-only line', () => {
    assert.throws(() =>
      MarketReportLLMSchema.parse({
        ...validReport,
        marketCatalysts: ['   '],
      }),
    );
  });

  it('5 regionalDivergence lines pass', () => {
    const regionalDivergence = Array.from({ length: 5 }, (_, i) => `Regional divergence ${i}`);
    const result = MarketReportLLMSchema.parse({
      ...validReport,
      regionalDivergence,
    });
    assert.equal(result.regionalDivergence.length, 5);
  });

  it('6 regionalDivergence lines fail', () => {
    const regionalDivergence = Array.from({ length: 6 }, (_, i) => `Regional divergence ${i}`);
    assert.throws(() => MarketReportLLMSchema.parse({ ...validReport, regionalDivergence }));
  });

  it('fails when regionalDivergence contains a whitespace-only line', () => {
    assert.throws(() =>
      MarketReportLLMSchema.parse({
        ...validReport,
        regionalDivergence: ['   '],
      }),
    );
  });

  it('5 narrativeShifts pass', () => {
    const narrativeShifts = Array.from({ length: 5 }, (_, i) => `Narrative shift ${i}`);
    const result = MarketReportLLMSchema.parse({
      ...validReport,
      narrativeShifts,
    });
    assert.equal(result.narrativeShifts.length, 5);
  });

  it('6 narrativeShifts fail', () => {
    const narrativeShifts = Array.from({ length: 6 }, (_, i) => `Narrative shift ${i}`);
    assert.throws(() => MarketReportLLMSchema.parse({ ...validReport, narrativeShifts }));
  });

  it('fails when narrativeShifts contains a whitespace-only line', () => {
    assert.throws(() =>
      MarketReportLLMSchema.parse({
        ...validReport,
        narrativeShifts: ['   '],
      }),
    );
  });

  it('5 eventChains pass', () => {
    const eventChains = Array.from({ length: 5 }, (_, i) => `Chain ${i}`);
    const result = MarketReportLLMSchema.parse({
      ...validReport,
      eventChains,
    });
    assert.equal(result.eventChains.length, 5);
  });

  it('6 eventChains fail', () => {
    const eventChains = Array.from({ length: 6 }, (_, i) => `Chain ${i}`);
    assert.throws(() => MarketReportLLMSchema.parse({ ...validReport, eventChains }));
  });

  it('5 firstMovers pass', () => {
    const firstMovers = Array.from({ length: 5 }, (_, i) => `First mover ${i}`);
    const result = MarketReportLLMSchema.parse({
      ...validReport,
      firstMovers,
    });
    assert.equal(result.firstMovers.length, 5);
  });

  it('6 firstMovers fail', () => {
    const firstMovers = Array.from({ length: 6 }, (_, i) => `First mover ${i}`);
    assert.throws(() => MarketReportLLMSchema.parse({ ...validReport, firstMovers }));
  });

  it('5 macroAlerts pass', () => {
    const macroAlerts = Array.from({ length: 5 }, (_, i) => `Macro alert ${i}`);
    const result = MarketReportLLMSchema.parse({
      ...validReport,
      macroAlerts,
    });
    assert.equal(result.macroAlerts.length, 5);
  });

  it('6 macroAlerts fail', () => {
    const macroAlerts = Array.from({ length: 6 }, (_, i) => `Macro alert ${i}`);
    assert.throws(() => MarketReportLLMSchema.parse({ ...validReport, macroAlerts }));
  });

  it('fails when priceAlerts contains a blank string', () => {
    assert.throws(() =>
      MarketReportLLMSchema.parse({
        ...validReport,
        priceAlerts: [' '],
      }),
    );
  });

  it('accepts macroRegime when classification is valid', () => {
    const result = MarketReportLLMSchema.parse({
      ...validReport,
      macroRegime: {
        classification: 'risk-off',
        confidence: 0.82,
        rationale: 'Dollar, yields, and gold all strengthened while crypto breadth stayed mixed.',
      },
    });
    assert.equal(result.macroRegime?.classification, 'risk-off');
  });

  it('rejects macroRegime when rationale is blank after trimming', () => {
    assert.throws(() =>
      MarketReportLLMSchema.parse({
        ...validReport,
        macroRegime: {
          classification: 'transition',
          confidence: 0.55,
          rationale: '   ',
        },
      }),
    );
  });

  it('rejects macroRegime when classification is invalid', () => {
    assert.throws(() =>
      MarketReportLLMSchema.parse({
        ...validReport,
        macroRegime: {
          classification: 'bullish',
          confidence: 0.82,
          rationale: 'Invalid classification',
        },
      }),
    );
  });

  it('rejects macroRegime when confidence is outside 0 to 1', () => {
    assert.throws(() =>
      MarketReportLLMSchema.parse({
        ...validReport,
        macroRegime: {
          classification: 'transition',
          confidence: 1.2,
          rationale: 'Too confident for mixed conditions.',
        },
      }),
    );
  });

  /* -- Default values -- */

  it('defaults keyEvents to [] when omitted', () => {
    const { keyEvents, ...rest } = validReport;
    const result = MarketReportLLMSchema.parse(rest);
    assert.deepStrictEqual(result.keyEvents, []);
  });

  it('defaults marketCatalysts to [] when omitted', () => {
    const { marketCatalysts, ...rest } = validReport;
    const result = MarketReportLLMSchema.parse(rest);
    assert.deepStrictEqual(result.marketCatalysts, []);
  });

  it('defaults regionalDivergence to [] when omitted', () => {
    const { regionalDivergence, ...rest } = {
      ...validReport,
      regionalDivergence: ['Bitcoin: EN stayed bullish while ID leaned bearish after the latest catalyst.'],
    };
    const result = MarketReportLLMSchema.parse(rest);
    assert.deepStrictEqual(result.regionalDivergence, []);
  });

  it('defaults narrativeShifts to [] when omitted', () => {
    const { narrativeShifts, ...rest } = { ...validReport, narrativeShifts: ['Breadth cooled around AI infra.'] };
    const result = MarketReportLLMSchema.parse(rest);
    assert.deepStrictEqual(result.narrativeShifts, []);
  });

  it('defaults eventChains to [] when omitted', () => {
    const { eventChains, ...rest } = validReport;
    const result = MarketReportLLMSchema.parse(rest);
    assert.deepStrictEqual(result.eventChains, []);
  });

  it('defaults firstMovers to [] when omitted', () => {
    const { firstMovers, ...rest } = { ...validReport, firstMovers: ['Early author line'] };
    const result = MarketReportLLMSchema.parse(rest);
    assert.deepStrictEqual(result.firstMovers, []);
  });

  it('defaults macroAlerts to [] when omitted', () => {
    const { macroAlerts, ...rest } = { ...validReport, macroAlerts: ['Risk-off backdrop'] };
    const result = MarketReportLLMSchema.parse(rest);
    assert.deepStrictEqual(result.macroAlerts, []);
  });

  it('defaults macroRegime to null when omitted', () => {
    const result = MarketReportLLMSchema.parse(validReport);
    assert.equal(result.macroRegime, null);
  });

  it('defaults entitySentiment to [] when omitted', () => {
    const { entitySentiment, ...rest } = validReport;
    const result = MarketReportLLMSchema.parse(rest);
    assert.deepStrictEqual(result.entitySentiment, []);
  });

  it('fails when entitySentiment reason is blank after trimming', () => {
    assert.throws(() =>
      MarketReportLLMSchema.parse({
        ...validReport,
        entitySentiment: [{ name: 'Bitcoin', sentiment: 0.3, reason: '   ' }],
      }),
    );
  });

  it('defaults sections to [] when omitted', () => {
    const { sections, ...rest } = validReport;
    const result = MarketReportLLMSchema.parse(rest);
    assert.deepStrictEqual(result.sections, []);
  });

  it('fails when section body is blank after trimming', () => {
    assert.throws(() =>
      MarketReportLLMSchema.parse({
        ...validReport,
        sections: [{ title: 'Overview', body: '   ' }],
      }),
    );
  });

  it('defaults newProjects to [] when omitted', () => {
    const { newProjects, ...rest } = validReport;
    const result = MarketReportLLMSchema.parse(rest);
    assert.deepStrictEqual(result.newProjects, []);
  });

  it('fails when newProjects description is blank after trimming', () => {
    assert.throws(() =>
      MarketReportLLMSchema.parse({
        ...validReport,
        newProjects: [{ name: 'CoolDAO', description: '   ' }],
      }),
    );
  });
});
