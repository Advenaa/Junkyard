import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ChunkSummaryLLMSchema,
  MarketReportLLMSchema,
} from '../../src/process/schemas.js';

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
    assert.throws(() =>
      ChunkSummaryLLMSchema.parse({ ...validChunk, summary: 'short' }),
    );
  });

  /* -- Sentiment boundaries -- */

  it('sentiment -1 passes', () => {
    const input = {
      ...validChunk,
      entities: [{ name: 'X', sentiment: -1 }],
    };
    const result = ChunkSummaryLLMSchema.parse(input);
    assert.equal(result.entities[0].sentiment, -1);
  });

  it('sentiment 1 passes', () => {
    const input = {
      ...validChunk,
      entities: [{ name: 'X', sentiment: 1 }],
    };
    const result = ChunkSummaryLLMSchema.parse(input);
    assert.equal(result.entities[0].sentiment, 1);
  });

  it('sentiment -1.001 fails', () => {
    assert.throws(() =>
      ChunkSummaryLLMSchema.parse({
        ...validChunk,
        entities: [{ name: 'X', sentiment: -1.001 }],
      }),
    );
  });

  it('sentiment 1.001 fails', () => {
    assert.throws(() =>
      ChunkSummaryLLMSchema.parse({
        ...validChunk,
        entities: [{ name: 'X', sentiment: 1.001 }],
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
    assert.throws(() =>
      ChunkSummaryLLMSchema.parse({ ...validChunk, confidence: 0 }),
    );
  });

  it('confidence 11 fails', () => {
    assert.throws(() =>
      ChunkSummaryLLMSchema.parse({ ...validChunk, confidence: 11 }),
    );
  });

  /* -- Entity array max -- */

  it('20 entities passes', () => {
    const entities = Array.from({ length: 20 }, (_, i) => ({
      name: `Entity${i}`,
    }));
    const result = ChunkSummaryLLMSchema.parse({
      ...validChunk,
      entities,
    });
    assert.equal(result.entities.length, 20);
  });

  it('21 entities fails', () => {
    const entities = Array.from({ length: 21 }, (_, i) => ({
      name: `Entity${i}`,
    }));
    assert.throws(() =>
      ChunkSummaryLLMSchema.parse({ ...validChunk, entities }),
    );
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
    assert.throws(() =>
      ChunkSummaryLLMSchema.parse({ ...validChunk, keyEvents }),
    );
  });

  /* -- Default values -- */

  it('defaults entities to [] when omitted', () => {
    const { entities, ...rest } = validChunk;
    const result = ChunkSummaryLLMSchema.parse(rest);
    assert.deepStrictEqual(result.entities, []);
  });

  it('defaults keyEvents to [] when omitted', () => {
    const { keyEvents, ...rest } = validChunk;
    const result = ChunkSummaryLLMSchema.parse(rest);
    assert.deepStrictEqual(result.keyEvents, []);
  });

  it('defaults entity type to "project" when omitted', () => {
    const input = {
      ...validChunk,
      entities: [{ name: 'SomeProject', sentiment: 0.2 }],
    };
    const result = ChunkSummaryLLMSchema.parse(input);
    assert.equal(result.entities[0].type, 'project');
  });

  it('defaults entity aliases to [] when omitted', () => {
    const input = {
      ...validChunk,
      entities: [{ name: 'X' }],
    };
    const result = ChunkSummaryLLMSchema.parse(input);
    assert.deepStrictEqual(result.entities[0].aliases, []);
  });

  it('defaults entity mentionCount to 1 when omitted', () => {
    const input = {
      ...validChunk,
      entities: [{ name: 'X' }],
    };
    const result = ChunkSummaryLLMSchema.parse(input);
    assert.equal(result.entities[0].mentionCount, 1);
  });

  it('defaults entity sentiment to 0 when omitted', () => {
    const input = {
      ...validChunk,
      entities: [{ name: 'X' }],
    };
    const result = ChunkSummaryLLMSchema.parse(input);
    assert.equal(result.entities[0].sentiment, 0);
  });
});

/* ------------------------------------------------------------------ */
/*  MarketReportLLMSchema                                             */
/* ------------------------------------------------------------------ */

describe('MarketReportLLMSchema', () => {
  const validReport = {
    tldr: 'Markets are calm today with minor movements across major tokens.',
    keyEvents: ['Fed held rates steady'],
    entitySentiment: [
      { name: 'Bitcoin', sentiment: 0.3, reason: 'Slow grind up' },
    ],
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
    assert.throws(() =>
      MarketReportLLMSchema.parse({ ...validReport, keyEvents }),
    );
  });

  /* -- Default values -- */

  it('defaults keyEvents to [] when omitted', () => {
    const { keyEvents, ...rest } = validReport;
    const result = MarketReportLLMSchema.parse(rest);
    assert.deepStrictEqual(result.keyEvents, []);
  });

  it('defaults entitySentiment to [] when omitted', () => {
    const { entitySentiment, ...rest } = validReport;
    const result = MarketReportLLMSchema.parse(rest);
    assert.deepStrictEqual(result.entitySentiment, []);
  });

  it('defaults sections to [] when omitted', () => {
    const { sections, ...rest } = validReport;
    const result = MarketReportLLMSchema.parse(rest);
    assert.deepStrictEqual(result.sections, []);
  });

  it('defaults newProjects to [] when omitted', () => {
    const { newProjects, ...rest } = validReport;
    const result = MarketReportLLMSchema.parse(rest);
    assert.deepStrictEqual(result.newProjects, []);
  });
});
