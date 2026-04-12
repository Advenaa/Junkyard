import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import {
  truncate,
  buildTitle,
  buildEmbed,
  buildFields,
  embedCharCount,
  enforceEmbedLimit,
  colorForType,
  createDelivery,
  recoverStalePendingReports,
} from '../../src/deliver/webhook.js';

describe('truncate', () => {
  it('returns text unchanged when under limit', () => {
    assert.strictEqual(truncate('hello', 10), 'hello');
  });

  it('truncates and adds ellipsis when over limit', () => {
    const result = truncate('hello world', 8);
    assert.strictEqual(result.length, 8);
    assert.ok(result.endsWith('...'));
    assert.strictEqual(result, 'hello...');
  });

  it('returns text unchanged when exactly at limit', () => {
    assert.strictEqual(truncate('hello', 5), 'hello');
  });
});

describe('buildTitle', () => {
  it('builds daily title', () => {
    const title = buildTitle('daily', '2026-04-01');
    assert.strictEqual(title, 'Daily Market Report \u2014 2026-04-01');
  });

  it('builds flash title', () => {
    const title = buildTitle('flash', '2026-04-01');
    assert.strictEqual(title, '[FLASH] Market Report \u2014 2026-04-01');
  });

  it('builds pulse title with WIB time', () => {
    const title = buildTitle('pulse', '2026-04-01');
    assert.ok(title.startsWith('Market Pulse \u2014 '));
    assert.ok(title.endsWith(' WIB'));
  });

  it('builds fallback title for unknown type', () => {
    const title = buildTitle('unknown', '2026-04-01');
    assert.strictEqual(title, 'Market Report \u2014 2026-04-01');
  });
});

describe('colorForType', () => {
  it('returns correct color for daily', () => {
    assert.strictEqual(colorForType('daily'), 0x5b8def);
  });

  it('returns correct color for flash', () => {
    assert.strictEqual(colorForType('flash'), 0xff6b35);
  });

  it('returns correct color for pulse', () => {
    assert.strictEqual(colorForType('pulse'), 0x4a4a5a);
  });

  it('returns default color for unknown type', () => {
    assert.strictEqual(colorForType('other'), 0x4a4a5a);
  });
});

describe('buildFields', () => {
  it('builds key events field with bullet formatting', () => {
    const parsed = {
      tldr: 'test',
      keyEvents: ['Event A', 'Event B'],
      eventChains: [],
      unusualActivity: [],
      macroAlerts: [],
      entitySentiment: [],
      sections: [],
      newProjects: [],
    };
    const fields = buildFields(parsed);
    assert.strictEqual(fields.length, 1);
    assert.strictEqual(fields[0]!.name, 'Key Events');
    assert.ok(fields[0]!.value.includes('> Event A'));
    assert.ok(fields[0]!.value.includes('> Event B'));
  });

  it('truncates field values to 1024 chars', () => {
    const longEvents = Array.from(
      { length: 100 },
      (_, i) => `Event number ${i} with some extra text to make it longer and fill up space`,
    );
    const parsed = {
      tldr: 'test',
      keyEvents: longEvents,
      eventChains: [],
      unusualActivity: [],
      macroAlerts: [],
      entitySentiment: [],
      sections: [],
      newProjects: [],
    };
    const fields = buildFields(parsed);
    assert.ok(fields[0]!.value.length <= 1024);
  });

  it('returns empty fields for empty parsed data', () => {
    const parsed = {
      tldr: 'test',
      keyEvents: [],
      eventChains: [],
      unusualActivity: [],
      macroAlerts: [],
      entitySentiment: [],
      sections: [],
      newProjects: [],
    };
    const fields = buildFields(parsed);
    assert.strictEqual(fields.length, 0);
  });

  it('limits fields to 4 maximum', () => {
    // Both keyEvents and entitySentiment produce fields, but max is 4
    const parsed = {
      tldr: 'test',
      keyEvents: ['Event A'],
      eventChains: ['Chain A'],
      unusualActivity: ['Author coordination spiked well above baseline.'],
      macroAlerts: ['Macro A'],
      entitySentiment: [
        { name: 'BTC', sentiment: 0.5, reason: 'bullish' },
        { name: 'ETH', sentiment: -0.5, reason: 'bearish' },
      ],
      sections: [],
      newProjects: [],
    };
    const fields = buildFields(parsed);
    assert.ok(fields.length <= 4);
  });

  it('builds event chains field with bullet formatting', () => {
    const parsed = {
      tldr: 'test',
      keyEvents: [],
      eventChains: ['Exploit -> audit -> governance response', 'Unlock -> muted follow-through'],
      firstMovers: [],
      unusualActivity: [],
      macroAlerts: [],
      entitySentiment: [],
      sections: [],
      newProjects: [],
    };
    const fields = buildFields(parsed);
    assert.strictEqual(fields.length, 1);
    assert.strictEqual(fields[0]!.name, 'Event Chains');
    assert.ok(fields[0]!.value.includes('> Exploit -> audit -> governance response'));
    assert.ok(fields[0]!.value.includes('> Unlock -> muted follow-through'));
  });

  it('builds first movers field with bullet formatting', () => {
    const parsed = {
      tldr: 'test',
      keyEvents: [],
      eventChains: [],
      firstMovers: [
        'Ethereum was first tracked by DeFi Dad roughly 4h before the next monitored call.',
        'Pendle was first tracked by Ignas 90m before broader monitored chatter picked up.',
      ],
      unusualActivity: [],
      macroAlerts: [],
      entitySentiment: [],
      sections: [],
      newProjects: [],
    };
    const fields = buildFields(parsed);
    assert.strictEqual(fields.length, 1);
    assert.strictEqual(fields[0]!.name, 'First Movers');
    assert.ok(
      fields[0]!.value.includes('> Ethereum was first tracked by DeFi Dad roughly 4h before the next monitored call.'),
    );
    assert.ok(
      fields[0]!.value.includes('> Pendle was first tracked by Ignas 90m before broader monitored chatter picked up.'),
    );
  });

  it('builds new projects field with name and description formatting', () => {
    const parsed = {
      tldr: 'test',
      keyEvents: [],
      eventChains: [],
      firstMovers: [],
      unusualActivity: [],
      macroAlerts: [],
      entitySentiment: [],
      sections: [],
      newProjects: [{ name: 'CoolDAO', description: 'A new DAO on Arbitrum' }],
    };
    const fields = buildFields(parsed);
    assert.strictEqual(fields.length, 1);
    assert.strictEqual(fields[0]!.name, 'New Projects');
    assert.ok(fields[0]!.value.includes('> **CoolDAO** — A new DAO on Arbitrum'));
  });

  it('omits new projects field when there are no entries', () => {
    const parsed = {
      tldr: 'test',
      keyEvents: [],
      eventChains: [],
      unusualActivity: [],
      macroAlerts: [],
      entitySentiment: [],
      sections: [],
      newProjects: [],
    };
    const fields = buildFields(parsed);
    assert.ok(fields.every((field) => field.name !== 'New Projects'));
  });

  it('builds price alerts field with bullet formatting', () => {
    const parsed = {
      tldr: 'test',
      keyEvents: [],
      eventChains: [],
      firstMovers: [],
      priceAlerts: [
        'SOL price climbed 11% in 24h while sentiment stayed neutral.',
        'ETH sentiment stayed bullish even as price slipped 4% on rising volume.',
      ],
      unusualActivity: [],
      macroAlerts: [],
      entitySentiment: [],
      sections: [],
      newProjects: [],
    };
    const fields = buildFields(parsed);
    assert.strictEqual(fields.length, 1);
    assert.strictEqual(fields[0]!.name, 'Price Alerts');
    assert.ok(fields[0]!.value.includes('> SOL price climbed 11% in 24h while sentiment stayed neutral.'));
    assert.ok(fields[0]!.value.includes('> ETH sentiment stayed bullish even as price slipped 4% on rising volume.'));
  });

  it('builds alpha signals field with bullet formatting', () => {
    const parsed = {
      tldr: 'test',
      keyEvents: [],
      eventChains: [],
      firstMovers: [],
      alphaSignals: [
        'Hyperliquid stayed mostly in alpha channels before broader CT caught up roughly 3h later.',
        'Monad testnet chatter jumped from influencer rooms into general feeds in under 2h.',
      ],
      unusualActivity: [],
      macroAlerts: [],
      entitySentiment: [],
      sections: [],
      newProjects: [],
    };
    const fields = buildFields(parsed);
    assert.strictEqual(fields.length, 1);
    assert.strictEqual(fields[0]!.name, 'Alpha Signals');
    assert.ok(
      fields[0]!.value.includes(
        '> Hyperliquid stayed mostly in alpha channels before broader CT caught up roughly 3h later.',
      ),
    );
    assert.ok(
      fields[0]!.value.includes('> Monad testnet chatter jumped from influencer rooms into general feeds in under 2h.'),
    );
  });

  it('builds market catalysts field with bullet formatting', () => {
    const parsed = {
      tldr: 'test',
      keyEvents: [],
      eventChains: [],
      firstMovers: [],
      marketCatalysts: [
        'US CPI lands in 6h with BTC-linked risk appetite still elevated.',
        'Fed speakers tomorrow could pressure rate-sensitive beta if yields stay firm.',
      ],
      unusualActivity: [],
      macroAlerts: [],
      entitySentiment: [],
      sections: [],
      newProjects: [],
    };
    const fields = buildFields(parsed);
    assert.strictEqual(fields.length, 1);
    assert.strictEqual(fields[0]!.name, 'Market Catalysts');
    assert.ok(fields[0]!.value.includes('> US CPI lands in 6h with BTC-linked risk appetite still elevated.'));
    assert.ok(
      fields[0]!.value.includes('> Fed speakers tomorrow could pressure rate-sensitive beta if yields stay firm.'),
    );
  });

  it('builds regional divergence field with bullet formatting', () => {
    const parsed = {
      tldr: 'test',
      keyEvents: [],
      eventChains: [],
      firstMovers: [],
      regionalDivergence: [
        'Bitcoin: EN stayed bullish while ID leaned bearish after the latest breakout attempt.',
        'Solana: ID momentum improved while EN chatter stayed cautious into the next catalyst window.',
      ],
      unusualActivity: [],
      macroAlerts: [],
      entitySentiment: [],
      sections: [],
      newProjects: [],
    };
    const fields = buildFields(parsed);
    assert.strictEqual(fields.length, 1);
    assert.strictEqual(fields[0]!.name, 'Regional Divergence');
    assert.ok(
      fields[0]!.value.includes(
        '> Bitcoin: EN stayed bullish while ID leaned bearish after the latest breakout attempt.',
      ),
    );
    assert.ok(
      fields[0]!.value.includes(
        '> Solana: ID momentum improved while EN chatter stayed cautious into the next catalyst window.',
      ),
    );
  });

  it('builds narrative shifts field with bullet formatting', () => {
    const parsed = {
      tldr: 'test',
      keyEvents: [],
      eventChains: [],
      firstMovers: [],
      narrativeShifts: [
        'Solana fee rebound broadened from a niche trading theme into a wider alt rotation watch.',
        'BTC treasury chatter faded after follow-through stalled in the latest summaries.',
      ],
      unusualActivity: [],
      macroAlerts: [],
      entitySentiment: [],
      sections: [],
      newProjects: [],
    };
    const fields = buildFields(parsed);
    assert.strictEqual(fields.length, 1);
    assert.strictEqual(fields[0]!.name, 'Narrative Shifts');
    assert.ok(
      fields[0]!.value.includes(
        '> Solana fee rebound broadened from a niche trading theme into a wider alt rotation watch.',
      ),
    );
    assert.ok(
      fields[0]!.value.includes('> BTC treasury chatter faded after follow-through stalled in the latest summaries.'),
    );
  });

  it('builds macro alerts field with bullet formatting', () => {
    const parsed = {
      tldr: 'test',
      keyEvents: [],
      eventChains: [],
      firstMovers: [],
      unusualActivity: [],
      macroAlerts: ['Crypto stayed bid into a firmer dollar.', 'Risk-off macro tape clashes with bullish alt chatter.'],
      entitySentiment: [],
      sections: [],
      newProjects: [],
    };
    const fields = buildFields(parsed);
    assert.strictEqual(fields.length, 1);
    assert.strictEqual(fields[0]!.name, 'Macro Alerts');
    assert.ok(fields[0]!.value.includes('> Crypto stayed bid into a firmer dollar.'));
    assert.ok(fields[0]!.value.includes('> Risk-off macro tape clashes with bullish alt chatter.'));
  });

  it('builds unusual activity field with bullet formatting', () => {
    const parsed = {
      tldr: 'test',
      keyEvents: [],
      eventChains: [],
      firstMovers: [],
      unusualActivity: [
        'Meme basket mentions surged 3.4x over baseline while average sentiment stayed neutral.',
        'Copy-trade style author overlap hit a new 14-day high around one small-cap ticker.',
      ],
      macroAlerts: [],
      entitySentiment: [],
      sections: [],
      newProjects: [],
    };
    const fields = buildFields(parsed);
    assert.strictEqual(fields.length, 1);
    assert.strictEqual(fields[0]!.name, 'Unusual Activity');
    assert.ok(
      fields[0]!.value.includes(
        '> Meme basket mentions surged 3.4x over baseline while average sentiment stayed neutral.',
      ),
    );
    assert.ok(
      fields[0]!.value.includes('> Copy-trade style author overlap hit a new 14-day high around one small-cap ticker.'),
    );
  });

  it('prioritizes unusual activity ahead of sentiment when the field cap is hit', () => {
    const parsed = {
      tldr: 'test',
      keyEvents: ['Event A'],
      eventChains: ['Chain A'],
      firstMovers: ['Bitcoin was first tracked by chainwatcher roughly 3h before the next monitored call.'],
      unusualActivity: ['Author coordination spiked well above baseline.'],
      macroRegime: {
        classification: 'risk-off' as const,
        confidence: 0.82,
        rationale: 'Dollar, yields, and gold all leaned defensive while crypto breadth stayed mixed.',
      },
      macroAlerts: ['Crypto stayed bid into a firmer dollar.'],
      entitySentiment: [{ name: 'BTC', sentiment: 0.5, reason: 'bullish' }],
      sections: [],
      newProjects: [],
    };
    const fields = buildFields(parsed);
    assert.strictEqual(fields.length, 4);
    assert.deepStrictEqual(
      fields.map((field) => field.name),
      ['Key Events', 'Event Chains', 'Macro Regime', 'First Movers'],
    );
  });

  it('prioritizes price alerts ahead of market catalysts and softer heuristics when first movers are absent', () => {
    const parsed = {
      tldr: 'test',
      keyEvents: ['Event A'],
      eventChains: ['Chain A'],
      priceAlerts: ['BTC ripped higher even as sentiment stayed flat.'],
      marketCatalysts: ['CPI in 6h could reset rate-sensitive positioning.'],
      unusualActivity: ['Author coordination spiked well above baseline.'],
      macroRegime: {
        classification: 'risk-on' as const,
        confidence: 0.71,
        rationale: 'Equities, crypto, and breadth all improved while the defensive tape eased.',
      },
      macroAlerts: ['Crypto stayed bid into a softer dollar.'],
      entitySentiment: [{ name: 'BTC', sentiment: 0.5, reason: 'bullish' }],
      sections: [],
      newProjects: [],
    };
    const fields = buildFields(parsed);
    assert.strictEqual(fields.length, 4);
    assert.deepStrictEqual(
      fields.map((field) => field.name),
      ['Key Events', 'Event Chains', 'Macro Regime', 'Price Alerts'],
    );
  });

  it('prioritizes market catalysts ahead of unusual activity and macro alerts when price alerts are absent', () => {
    const parsed = {
      tldr: 'test',
      keyEvents: ['Event A'],
      eventChains: ['Chain A'],
      marketCatalysts: ['CPI in 6h could reset rate-sensitive positioning.'],
      unusualActivity: ['Author coordination spiked well above baseline.'],
      macroRegime: {
        classification: 'risk-on' as const,
        confidence: 0.71,
        rationale: 'Equities, crypto, and breadth all improved while the defensive tape eased.',
      },
      macroAlerts: ['Crypto stayed bid into a softer dollar.'],
      entitySentiment: [{ name: 'BTC', sentiment: 0.5, reason: 'bullish' }],
      sections: [],
      newProjects: [],
    };
    const fields = buildFields(parsed);
    assert.strictEqual(fields.length, 4);
    assert.deepStrictEqual(
      fields.map((field) => field.name),
      ['Key Events', 'Event Chains', 'Macro Regime', 'Market Catalysts'],
    );
  });

  it('prioritizes alpha signals ahead of market catalysts and softer heuristics when price alerts are absent', () => {
    const parsed = {
      tldr: 'test',
      keyEvents: ['Event A'],
      eventChains: ['Chain A'],
      alphaSignals: ['Hyperliquid stayed concentrated in alpha rooms before broader chatter caught up 3h later.'],
      marketCatalysts: ['Fed minutes tomorrow could move risk assets.'],
      unusualActivity: ['Author coordination spiked well above baseline.'],
      macroRegime: {
        classification: 'transition' as const,
        confidence: 0.64,
        rationale: 'Risk assets and defensive signals both stayed active, leaving the tape mixed.',
      },
      macroAlerts: ['Crypto stayed bid even as yields remained sticky.'],
      entitySentiment: [{ name: 'BTC', sentiment: 0.5, reason: 'bullish' }],
      sections: [],
      newProjects: [],
    };
    const fields = buildFields(parsed);
    assert.strictEqual(fields.length, 4);
    assert.deepStrictEqual(
      fields.map((field) => field.name),
      ['Key Events', 'Event Chains', 'Macro Regime', 'Alpha Signals'],
    );
  });

  it('prioritizes regional divergence ahead of unusual activity and macro alerts when higher-priority watchlists are absent', () => {
    const parsed = {
      tldr: 'test',
      keyEvents: ['Event A'],
      eventChains: ['Chain A'],
      regionalDivergence: ['Bitcoin: EN stayed bullish while ID leaned bearish after the latest breakout attempt.'],
      unusualActivity: ['Author coordination spiked well above baseline.'],
      macroRegime: {
        classification: 'transition' as const,
        confidence: 0.64,
        rationale: 'Risk assets and defensive signals both stayed active, leaving the tape mixed.',
      },
      macroAlerts: ['Crypto stayed bid even as yields remained sticky.'],
      entitySentiment: [{ name: 'BTC', sentiment: 0.5, reason: 'bullish' }],
      sections: [],
      newProjects: [],
    };
    const fields = buildFields(parsed);
    assert.strictEqual(fields.length, 4);
    assert.deepStrictEqual(
      fields.map((field) => field.name),
      ['Key Events', 'Event Chains', 'Macro Regime', 'Regional Divergence'],
    );
  });

  it('prioritizes narrative shifts ahead of unusual activity and macro alerts when higher-priority watchlists are absent', () => {
    const parsed = {
      tldr: 'test',
      keyEvents: ['Event A'],
      eventChains: ['Chain A'],
      narrativeShifts: ['AI infra rotation broadened beyond the first-mover crowd into a wider beta watchlist.'],
      unusualActivity: ['Author coordination spiked well above baseline.'],
      macroRegime: {
        classification: 'transition' as const,
        confidence: 0.64,
        rationale: 'Risk assets and defensive signals both stayed active, leaving the tape mixed.',
      },
      macroAlerts: ['Crypto stayed bid even as yields remained sticky.'],
      entitySentiment: [{ name: 'BTC', sentiment: 0.5, reason: 'bullish' }],
      sections: [],
      newProjects: [],
    };
    const fields = buildFields(parsed);
    assert.strictEqual(fields.length, 4);
    assert.deepStrictEqual(
      fields.map((field) => field.name),
      ['Key Events', 'Event Chains', 'Macro Regime', 'Narrative Shifts'],
    );
  });

  it('builds macro regime field with confidence and rationale', () => {
    const parsed = {
      tldr: 'test',
      keyEvents: [],
      eventChains: [],
      firstMovers: [],
      unusualActivity: [],
      macroRegime: {
        classification: 'risk-off' as const,
        confidence: 0.82,
        rationale: 'Dollar, yields, and gold all leaned defensive while crypto breadth stayed mixed.',
      },
      macroAlerts: [],
      entitySentiment: [],
      sections: [],
      newProjects: [],
    };
    const fields = buildFields(parsed);
    assert.strictEqual(fields.length, 1);
    assert.strictEqual(fields[0]!.name, 'Macro Regime');
    assert.ok(fields[0]!.value.includes('> Risk-off (82% confidence)'));
    assert.ok(
      fields[0]!.value.includes('> Dollar, yields, and gold all leaned defensive while crypto breadth stayed mixed.'),
    );
  });

  it('tolerates older parsed reports without unusualActivity or macroAlerts', () => {
    const parsed = {
      tldr: 'test',
      keyEvents: ['Event A'],
      eventChains: [],
      firstMovers: [],
      entitySentiment: [],
      sections: [],
      newProjects: [],
    };
    const fields = buildFields(parsed);
    assert.strictEqual(fields.length, 1);
    assert.strictEqual(fields[0]!.name, 'Key Events');
  });

  it('accepts snake_case report bodies for new delivery fields', () => {
    const parsed = {
      tldr: 'test',
      keyEvents: [],
      eventChains: [],
      price_alerts: ['BTC price kept rising even as trader sentiment cooled.'],
      alpha_signals: [
        'BTC treasury chatter stayed concentrated in alpha rooms before broader CT picked it up hours later.',
      ],
      market_catalysts: ['Fed minutes tomorrow could move risk assets.'],
      regional_divergence: ['Bitcoin: EN stayed bullish while ID leaned bearish after the latest breakout attempt.'],
      narrative_shifts: ['Meme-beta rotation cooled after the latest follow-through failed to broaden.'],
      unusual_activity: ['Mentions spiked far above the trailing baseline.'],
      macro_alerts: ['Crypto held up despite firmer yields.'],
      entity_sentiment: [{ name: 'BTC', sentiment: 0.4, reason: 'bullish' }],
      sections: [],
      new_projects: [],
    };
    const fields = buildFields(parsed);
    assert.deepStrictEqual(
      fields.map((field) => field.name),
      ['Price Alerts', 'Alpha Signals', 'Market Catalysts', 'Regional Divergence'],
    );
  });
});

describe('buildEmbed — description truncation', () => {
  it('truncates description to 4096 chars', () => {
    const longTldr = 'A'.repeat(5000);
    const report = { id: 'test-1', type: 'daily', body: '{}', date: '2026-04-01' };
    const parsed = {
      tldr: longTldr,
      keyEvents: [],
      eventChains: [],
      unusualActivity: [],
      macroAlerts: [],
      entitySentiment: [],
      sections: [],
      newProjects: [],
    };
    const config = {} as any;
    const embed = buildEmbed(report, parsed, config);
    assert.ok(embed.description.length <= 4096);
  });
});

describe('enforceEmbedLimit — total embed under 6000', () => {
  it('enforces total embed stays under 5900 chars', () => {
    const embed = {
      title: 'Test Title',
      description: 'A'.repeat(4000),
      color: 0x5b8def,
      fields: [
        { name: 'Field 1', value: 'B'.repeat(1000), inline: false },
        { name: 'Field 2', value: 'C'.repeat(1000), inline: false },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'podders' },
    };

    // Total before enforcement: 10 + 4000 + 7 + 7 + 1000 + 7 + 1000 = 6031 > 5900
    enforceEmbedLimit(embed);
    const total = embedCharCount(embed);
    assert.ok(total <= 5900, `Total embed chars ${total} exceeds 5900`);
  });

  it('trims longest field first', () => {
    const embed = {
      title: 'Title',
      description: 'A'.repeat(4000),
      color: 0x5b8def,
      fields: [
        { name: 'Short', value: 'B'.repeat(100), inline: false },
        { name: 'Long', value: 'C'.repeat(2000), inline: false },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'podders' },
    };

    enforceEmbedLimit(embed);
    // The long field should have been trimmed, not the short one
    assert.ok(embed.fields.some((f) => f.name === 'Short' && f.value.length === 100));
  });

  it('removes fields if they cannot be trimmed meaningfully', () => {
    const embed = {
      title: 'Title',
      description: 'A'.repeat(5800),
      color: 0x5b8def,
      fields: [{ name: 'Tiny', value: 'B', inline: false }],
      timestamp: new Date().toISOString(),
      footer: { text: 'podders' },
    };

    enforceEmbedLimit(embed);
    const total = embedCharCount(embed);
    assert.ok(total <= 5900, `Total embed chars ${total} exceeds 5900`);
  });

  it('trims description as last resort', () => {
    const embed = {
      title: 'Title',
      description: 'A'.repeat(5900),
      color: 0x5b8def,
      fields: [],
      timestamp: new Date().toISOString(),
      footer: { text: 'podders' },
    };

    enforceEmbedLimit(embed);
    const total = embedCharCount(embed);
    assert.ok(total <= 5900, `Total embed chars ${total} exceeds 5900`);
    assert.ok(embed.description.length < 5900);
  });

  it('leaves embed unchanged when already under limit', () => {
    const embed = {
      title: 'Title',
      description: 'Short desc',
      color: 0x5b8def,
      fields: [{ name: 'F', value: 'val', inline: false }],
      timestamp: new Date().toISOString(),
      footer: { text: 'podders' },
    };

    const descBefore = embed.description;
    enforceEmbedLimit(embed);
    assert.strictEqual(embed.description, descBefore);
  });
});

describe('buildEmbed — full integration', () => {
  it('sets url when publicUrl is configured', () => {
    const report = { id: 'rpt-abc', type: 'daily', body: '{}', date: '2026-04-01' };
    const parsed = {
      tldr: 'Market summary',
      keyEvents: ['BTC pumped'],
      eventChains: ['BTC exploit chain still active after audit response.'],
      unusualActivity: [],
      entitySentiment: [],
      sections: [],
      newProjects: [],
    };
    const config = { publicUrl: 'https://podders.example.com' } as any;
    const embed = buildEmbed(report, parsed, config);
    assert.strictEqual(embed.url, 'https://podders.example.com/reports/rpt-abc');
  });

  it('omits url when publicUrl is not configured', () => {
    const report = { id: 'rpt-abc', type: 'daily', body: '{}', date: '2026-04-01' };
    const parsed = {
      tldr: 'Market summary',
      keyEvents: [],
      eventChains: [],
      unusualActivity: [],
      entitySentiment: [],
      sections: [],
      newProjects: [],
    };
    const config = {} as any;
    const embed = buildEmbed(report, parsed, config);
    assert.strictEqual(embed.url, undefined);
  });

  it('total embed always under 6000 even with large content', () => {
    const report = { id: 'rpt-big', type: 'flash', body: '{}', date: '2026-04-01' };
    const parsed = {
      tldr: 'X'.repeat(4096),
      keyEvents: Array.from(
        { length: 20 },
        (_, i) => `Major event number ${i} with detailed description that goes on for a while`,
      ),
      eventChains: Array.from(
        { length: 5 },
        (_, i) => `Chain ${i} remains active after another step in the story with extra detail to add size`,
      ),
      unusualActivity: Array.from(
        { length: 5 },
        (_, i) => `Unusual cluster ${i} stayed elevated versus its 14-day baseline with extra context to add size`,
      ),
      entitySentiment: Array.from({ length: 10 }, (_, i) => ({
        name: `Token${i}`,
        sentiment: i % 3 === 0 ? 0.8 : -0.5,
        reason: 'test reason',
      })),
      sections: [],
      newProjects: [],
    };
    const config = { publicUrl: 'https://example.com' } as any;
    const embed = buildEmbed(report, parsed, config);
    const total = embedCharCount(embed);
    assert.ok(total <= 6000, `Total embed chars ${total} exceeds 6000`);
  });
});

// ---------------------------------------------------------------------------
// deliver — idempotency guard (DL-001 regression)
// ---------------------------------------------------------------------------

const VALID_REPORT_BODY = JSON.stringify({
  tldr: 'Market moved up',
  keyEvents: ['BTC pumped'],
  eventChains: ['BTC exploit chain remains active after the audit update.'],
  unusualActivity: ['Meme basket mentions surged well above their baseline.'],
  entitySentiment: [{ name: 'BTC', sentiment: 0.5, reason: 'bullish' }],
  sections: [],
  newProjects: [],
});

const FAKE_REPORT = {
  id: 'rpt-idem-001',
  type: 'daily' as const,
  body: VALID_REPORT_BODY,
  date: '2026-04-01',
};

/** Silent logger that swallows everything. */
const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => silentLog,
};

/**
 * Build a mock Pool whose .query() returns responses in order.
 * Callers push expected responses; the pool pops them sequentially.
 */
function mockPool(responses: Array<{ rows?: unknown[]; rowCount?: number }> = []) {
  let callIndex = 0;
  const calls: Array<{ text: string; values: unknown[] }> = [];
  return {
    calls,
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values: values ?? [] });
      const resp = responses[callIndex] ?? { rows: [], rowCount: 0 };
      callIndex++;
      return { rows: resp.rows ?? [], rowCount: resp.rowCount ?? 0 };
    },
  };
}

function createDeliveryCircuitPool(webhookUrl = 'https://discord.com/api/webhooks/123/abc') {
  const calls: Array<{ text: string; values: unknown[] }> = [];

  return {
    calls,
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values: values ?? [] });

      if (text.includes('SELECT value FROM app_config WHERE key = $1')) {
        return { rows: [{ value: webhookUrl }], rowCount: 1 };
      }

      if (text.includes("UPDATE reports SET delivery_status = 'pending'") && text.includes('RETURNING')) {
        return { rows: [{ delivery_status: 'pending' }], rowCount: 1 };
      }

      if (text.includes('UPDATE reports SET delivery_status = $1')) {
        return { rows: [], rowCount: 1 };
      }

      if (text.includes('SELECT id, type, body, date FROM reports')) {
        return { rows: [], rowCount: 0 };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

describe('deliver — missing webhook_url marks failed (SD-001 regression)', () => {
  it('marks report as failed when webhook_url is not configured', async () => {
    // Pool responses:
    // 1. getAppConfig('webhook_url') → no rows (not configured)
    // 2. UPDATE reports SET delivery_status = 'failed'
    const pool = mockPool([{ rows: [] }, { rowCount: 1 }]);

    const config = {} as any;
    const { deliver } = createDelivery(pool as any, silentLog as any, config);
    const result = await deliver(FAKE_REPORT);

    // deliver returns false when webhook_url is missing
    assert.strictEqual(result, false);

    // Verify delivery_status was updated to 'failed'
    const updateQuery = pool.calls.find((c) => c.text.includes('UPDATE reports SET delivery_status'));
    assert.ok(updateQuery, 'Expected an UPDATE delivery_status query');
    assert.strictEqual(updateQuery.values[0], 'failed');
    assert.strictEqual(updateQuery.values[2], FAKE_REPORT.id);
  });
});

describe('deliver — idempotency guard', () => {
  it('skips delivery when report already delivered', async (t) => {
    // Pool responses:
    // 1. getAppConfig('webhook_url') → returns a valid webhook URL
    // 2. Atomic UPDATE...RETURNING → 0 rows (already delivered)
    const pool = mockPool([{ rows: [{ value: 'https://discord.com/api/webhooks/123/abc' }] }, { rows: [] }]);

    // Mock DNS so validateUrl passes
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['104.16.60.37']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });

    // Mock fetch — should NOT be called
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
      return new Response(null, { status: 200 });
    });

    const config = {} as any;
    const { deliver } = createDelivery(pool as any, silentLog as any, config);
    const result = await deliver(FAKE_REPORT);

    // Idempotent success — returns true without making HTTP POST
    assert.strictEqual(result, true);
    assert.strictEqual(fetchMock.mock.callCount(), 0);

    // Verify the atomic UPDATE was made (DL-014: atomic idempotency)
    const claimQuery = pool.calls.find((c) => c.text.includes('UPDATE reports') && c.text.includes('RETURNING'));
    assert.ok(claimQuery, 'Expected an atomic UPDATE...RETURNING query');
    assert.deepStrictEqual(claimQuery.values, [FAKE_REPORT.id]);

    fetchMock.mock.restore();
    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('proceeds with delivery when status is pending', async (t) => {
    // Pool responses:
    // 1. getAppConfig('webhook_url') → returns a valid webhook URL
    // 2. Atomic UPDATE...RETURNING → 1 row (claimed for delivery)
    // 3. UPDATE reports SET delivery_status = 'delivered'
    const pool = mockPool([
      { rows: [{ value: 'https://discord.com/api/webhooks/123/abc' }] },
      { rows: [{ delivery_status: 'pending' }] },
      { rowCount: 1 },
    ]);

    // Mock DNS so validateUrl passes
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['104.16.60.37']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });

    // Mock fetch — should be called with Discord webhook POST
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
      return new Response(null, { status: 200 });
    });

    const config = {} as any;
    const { deliver } = createDelivery(pool as any, silentLog as any, config);
    const result = await deliver(FAKE_REPORT);

    // Delivery succeeded
    assert.strictEqual(result, true);

    // Verify the HTTP POST was made
    assert.strictEqual(fetchMock.mock.callCount(), 1);
    const [url, opts] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit];
    assert.strictEqual(opts.method, 'POST');
    assert.ok(url.includes('discord.com'), 'Expected original hostname in URL');

    // Verify body contains embeds
    const body = JSON.parse(opts.body as string);
    assert.ok(Array.isArray(body.embeds), 'Expected embeds array in body');
    assert.strictEqual(body.embeds.length, 1);

    // Verify delivery_status was updated to 'delivered'
    const updateQuery = pool.calls.find(
      (c) => c.text.includes('delivery_status = $1') && !c.text.includes('RETURNING'),
    );
    assert.ok(updateQuery, 'Expected an UPDATE delivery_status query');
    assert.strictEqual(updateQuery.values[0], 'delivered');
    assert.strictEqual(updateQuery.values[2], FAKE_REPORT.id);

    fetchMock.mock.restore();
    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('reconciles delivered status without re-posting when the DB update fails after a successful POST', async (t) => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    let deliveredUpdateAttempts = 0;
    const pool = {
      calls,
      async query(text: string, values?: unknown[]) {
        calls.push({ text, values: values ?? [] });

        if (text.includes('SELECT value FROM app_config WHERE key = $1')) {
          return { rows: [{ value: 'https://discord.com/api/webhooks/123/abc' }], rowCount: 1 };
        }

        if (text.includes("UPDATE reports SET delivery_status = 'pending'") && text.includes('RETURNING')) {
          return { rows: [{ delivery_status: 'pending' }], rowCount: 1 };
        }

        if (text.includes('UPDATE reports SET delivery_status = $1') && values?.[0] === 'delivered') {
          deliveredUpdateAttempts++;
          if (deliveredUpdateAttempts === 1) {
            throw new Error('db write failed after webhook POST');
          }
          return { rows: [], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      },
    };

    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['104.16.60.37']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
      return new Response(null, { status: 200 });
    });

    const config = {} as any;
    const { deliver } = createDelivery(pool as any, silentLog as any, config);

    const firstAttempt = await deliver(FAKE_REPORT);
    const secondAttempt = await deliver(FAKE_REPORT);

    assert.strictEqual(
      firstAttempt,
      false,
      'delivery must not report success when the delivered status fails to persist',
    );
    assert.strictEqual(secondAttempt, true, 'a later attempt should reconcile delivered status once the DB recovers');
    assert.strictEqual(fetchMock.mock.callCount(), 1, 'status reconciliation must not send a duplicate webhook POST');
    assert.strictEqual(resolve4Mock.mock.callCount(), 1, 'status reconciliation should not repeat DNS validation');
    assert.strictEqual(resolve6Mock.mock.callCount(), 1, 'status reconciliation should not repeat IPv6 validation');

    const claimQueries = calls.filter(
      (call) => call.text.includes("UPDATE reports SET delivery_status = 'pending'") && call.text.includes('RETURNING'),
    );
    assert.strictEqual(claimQueries.length, 1, 'status reconciliation should not re-claim the report for another POST');

    const deliveredUpdates = calls.filter(
      (call) => call.text.includes('UPDATE reports SET delivery_status = $1') && call.values[0] === 'delivered',
    );
    assert.strictEqual(deliveredUpdates.length, 2, 'delivery should retry only the delivered-status persistence');

    fetchMock.mock.restore();
    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('reuses the original DNS validation across delivery retries', async (t) => {
    const pool = mockPool([
      { rows: [{ value: 'https://discord.com/api/webhooks/123/abc' }] },
      { rows: [{ delivery_status: 'pending' }] },
      { rowCount: 1 },
    ]);

    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['104.16.60.37']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });
    let fetchAttempt = 0;
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
      fetchAttempt++;
      return new Response(null, { status: fetchAttempt === 1 ? 500 : 200 });
    });
    const setTimeoutMock = t.mock.method(globalThis, 'setTimeout', ((callback: (...args: any[]) => void) => {
      callback();
      return 0;
    }) as typeof setTimeout);

    const config = {} as any;
    const { deliver } = createDelivery(pool as any, silentLog as any, config);
    const result = await deliver(FAKE_REPORT);

    assert.strictEqual(result, true);
    assert.strictEqual(fetchMock.mock.callCount(), 2, 'delivery should retry once after a 5xx response');
    assert.strictEqual(
      resolve4Mock.mock.callCount(),
      1,
      'delivery retries should reuse the first validated IPv4 result',
    );
    assert.strictEqual(resolve6Mock.mock.callCount(), 1, 'delivery retries should not re-run IPv6 resolution either');

    const firstCall = fetchMock.mock.calls[0]!.arguments as [string, RequestInit];
    const secondCall = fetchMock.mock.calls[1]!.arguments as [string, RequestInit];
    assert.strictEqual(firstCall[0], 'https://discord.com/api/webhooks/123/abc');
    assert.strictEqual(secondCall[0], 'https://discord.com/api/webhooks/123/abc');
    assert.ok(firstCall[1].dispatcher, 'first delivery attempt should use a pinned dispatcher');
    assert.ok(secondCall[1].dispatcher, 'retry should also use a pinned dispatcher');

    setTimeoutMock.mock.restore();
    fetchMock.mock.restore();
    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });
});

describe('deliver — terminal failure context', () => {
  it('logs the terminal webhook status and response detail after a client error', async (t) => {
    const pool = mockPool([
      { rows: [{ value: 'https://discord.com/api/webhooks/123/abc' }] },
      { rows: [{ delivery_status: 'pending' }] },
      { rowCount: 1 },
    ]);

    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['104.16.60.37']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
      return new Response('webhook deleted remotely', { status: 404 });
    });

    const errorCalls: Array<{ payload: unknown; message?: string }> = [];
    const log = {
      ...silentLog,
      error: (payload: unknown, message?: string) => {
        errorCalls.push({ payload, message });
      },
    };

    const config = {} as any;
    const { deliver } = createDelivery(pool as any, log as any, config);
    const result = await deliver(FAKE_REPORT);

    assert.strictEqual(result, false);
    const terminalError = errorCalls.find((entry) => entry.message === 'webhook delivery failed after retries');
    assert.ok(terminalError, 'Expected the terminal delivery failure to be logged');
    assert.deepStrictEqual(terminalError.payload, {
      reportId: FAKE_REPORT.id,
      type: FAKE_REPORT.type,
      failureReason: 'client_error',
      status: 404,
      responseDetail: 'webhook deleted remotely',
      errorMessage: undefined,
    });

    fetchMock.mock.restore();
    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });
});

describe('deliver — circuit breaker', () => {
  it('halts after five consecutive failed deliveries, alerts once, and skips retryFailed while open', async (t) => {
    const pool = createDeliveryCircuitPool();

    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['104.16.60.37']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });

    let reportPostCount = 0;
    let alertPostCount = 0;
    const fetchMock = t.mock.method(globalThis, 'fetch', async (input) => {
      const url = String(input);
      if (url.includes('/999/alert')) {
        alertPostCount++;
        return new Response(null, { status: 204 });
      }

      reportPostCount++;
      return new Response(null, { status: 500 });
    });

    const setTimeoutMock = t.mock.method(globalThis, 'setTimeout', ((callback: (...args: any[]) => void) => {
      callback();
      return 0;
    }) as typeof setTimeout);

    const config = { alertWebhookUrl: 'https://discord.com/api/webhooks/999/alert' } as any;
    const { deliver, retryFailed } = createDelivery(pool as any, silentLog as any, config);

    for (let index = 0; index < 6; index++) {
      const result = await deliver({ ...FAKE_REPORT, id: `rpt-breaker-${index}` });
      assert.strictEqual(result, false);
    }

    assert.strictEqual(
      reportPostCount,
      15,
      'the sixth delivery should be skipped after the breaker trips on the fifth consecutive failure',
    );
    assert.strictEqual(alertPostCount, 1, 'breaker should alert ops once when it trips');

    const retried = await retryFailed();
    assert.strictEqual(retried, 0, 'retryFailed should skip while the breaker is open');
    assert.strictEqual(reportPostCount, 15, 'retryFailed should not hit the report webhook while halted');
    assert.ok(
      !pool.calls.some((call) => call.text.includes('SELECT id, type, body, date FROM reports')),
      'retryFailed should return before querying failed reports while the breaker is open',
    );

    setTimeoutMock.mock.restore();
    fetchMock.mock.restore();
    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('resets the consecutive-failure counter after a successful delivery', async (t) => {
    const pool = createDeliveryCircuitPool();

    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['104.16.60.37']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });

    const reportStatuses = [...Array(12).fill(500), 200, ...Array(12).fill(500)];
    let reportPostCount = 0;
    let alertPostCount = 0;
    const fetchMock = t.mock.method(globalThis, 'fetch', async (input) => {
      const url = String(input);
      if (url.includes('/999/alert')) {
        alertPostCount++;
        return new Response(null, { status: 204 });
      }

      const status = reportStatuses[reportPostCount] ?? 500;
      reportPostCount++;
      return new Response(null, { status });
    });

    const setTimeoutMock = t.mock.method(globalThis, 'setTimeout', ((callback: (...args: any[]) => void) => {
      callback();
      return 0;
    }) as typeof setTimeout);

    const config = { alertWebhookUrl: 'https://discord.com/api/webhooks/999/alert' } as any;
    const { deliver } = createDelivery(pool as any, silentLog as any, config);

    for (let index = 0; index < 4; index++) {
      const result = await deliver({ ...FAKE_REPORT, id: `rpt-reset-fail-${index}` });
      assert.strictEqual(result, false);
    }

    const success = await deliver({ ...FAKE_REPORT, id: 'rpt-reset-success' });
    assert.strictEqual(success, true);

    for (let index = 0; index < 4; index++) {
      const result = await deliver({ ...FAKE_REPORT, id: `rpt-reset-after-${index}` });
      assert.strictEqual(result, false);
    }

    assert.strictEqual(alertPostCount, 0, 'a success in the middle should reset the consecutive failure count');
    assert.strictEqual(reportPostCount, 25, 'deliveries after the reset should continue attempting the webhook');

    setTimeoutMock.mock.restore();
    fetchMock.mock.restore();
    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });

  it('resumes delivery attempts after the cooldown elapses', async (t) => {
    const pool = createDeliveryCircuitPool();

    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['104.16.60.37']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });

    let now = 1_700_000_000_000;
    const dateNowMock = t.mock.method(Date, 'now', () => now);

    let reportPostCount = 0;
    let alertPostCount = 0;
    const fetchMock = t.mock.method(globalThis, 'fetch', async (input) => {
      const url = String(input);
      if (url.includes('/999/alert')) {
        alertPostCount++;
        return new Response(null, { status: 204 });
      }

      reportPostCount++;
      return new Response(null, { status: reportPostCount <= 15 ? 500 : 200 });
    });

    const setTimeoutMock = t.mock.method(globalThis, 'setTimeout', ((callback: (...args: any[]) => void) => {
      callback();
      return 0;
    }) as typeof setTimeout);

    const config = { alertWebhookUrl: 'https://discord.com/api/webhooks/999/alert' } as any;
    const { deliver } = createDelivery(pool as any, silentLog as any, config);

    for (let index = 0; index < 5; index++) {
      const result = await deliver({ ...FAKE_REPORT, id: `rpt-cooldown-fail-${index}` });
      assert.strictEqual(result, false);
    }

    now += 60 * 60 * 1000 + 1;

    const resultAfterCooldown = await deliver({ ...FAKE_REPORT, id: 'rpt-cooldown-success' });
    assert.strictEqual(resultAfterCooldown, true);
    assert.strictEqual(alertPostCount, 1, 'cooldown recovery should reuse the original breaker alert');
    assert.strictEqual(reportPostCount, 16, 'delivery should resume with a fresh webhook POST after cooldown');

    const deliveredUpdate = pool.calls.find(
      (call) => call.text.includes('UPDATE reports SET delivery_status = $1') && call.values[0] === 'delivered',
    );
    assert.ok(deliveredUpdate, 'post-cooldown success should persist delivered status');

    setTimeoutMock.mock.restore();
    fetchMock.mock.restore();
    dateNowMock.mock.restore();
    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
  });
});

describe('retryFailed — lookback window', () => {
  it('retries failed dailies for 24h while leaving older pulses outside the retry window', async (t) => {
    const now = 1_700_000_000_000;
    const reports = [
      {
        id: 'daily-old',
        type: 'daily',
        body: VALID_REPORT_BODY,
        date: '2026-04-01',
        created_at: now - 3 * 60 * 60 * 1000,
        delivery_status: 'failed',
      },
      {
        id: 'pulse-old',
        type: 'pulse',
        body: VALID_REPORT_BODY,
        date: '2026-04-01',
        created_at: now - 3 * 60 * 60 * 1000,
        delivery_status: 'failed',
      },
    ];

    const calls: Array<{ text: string; values: unknown[] }> = [];
    const pool = {
      calls,
      async query(text: string, values?: unknown[]) {
        calls.push({ text, values: values ?? [] });

        if (text.includes('SELECT value FROM app_config WHERE key = $1')) {
          return { rows: [{ value: 'https://discord.com/api/webhooks/123/abc' }], rowCount: 1 };
        }

        if (text.includes('SELECT id, type, body, date FROM reports')) {
          const [dailyCutoff, defaultCutoff] = (values ?? []) as [number, number];
          const eligible = reports
            .filter(
              (report) =>
                report.delivery_status === 'failed' &&
                ((report.type === 'daily' && report.created_at > dailyCutoff) ||
                  (report.type !== 'daily' && report.created_at > defaultCutoff)),
            )
            .map(({ id, type, body, date }) => ({ id, type, body, date }));
          return { rows: eligible, rowCount: eligible.length };
        }

        if (text.includes("UPDATE reports SET delivery_status = 'pending'") && text.includes('RETURNING')) {
          return { rows: [{ delivery_status: 'pending' }], rowCount: 1 };
        }

        if (text.includes('UPDATE reports SET delivery_status = $1')) {
          const status = values?.[0] as string;
          const reportId = values?.[2] as string;
          const report = reports.find((entry) => entry.id === reportId);
          if (report) {
            report.delivery_status = status;
          }
          return { rows: [], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      },
    };

    const dateNowMock = t.mock.method(Date, 'now', () => now);
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['104.16.60.37']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));

    const config = {} as any;
    const { retryFailed } = createDelivery(pool as any, silentLog as any, config);
    const retried = await retryFailed();

    assert.strictEqual(retried, 1, 'Expected only the daily report to be retried');
    const deliveredUpdates = pool.calls.filter(
      (call) => call.text.includes('UPDATE reports SET delivery_status = $1') && call.values[0] === 'delivered',
    );
    assert.strictEqual(deliveredUpdates.length, 1);
    assert.strictEqual(deliveredUpdates[0]!.values[2], 'daily-old');
    assert.strictEqual(reports.find((report) => report.id === 'daily-old')!.delivery_status, 'delivered');
    assert.strictEqual(reports.find((report) => report.id === 'pulse-old')!.delivery_status, 'failed');

    fetchMock.mock.restore();
    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
    dateNowMock.mock.restore();
  });

  it('retries stale pending reports while leaving fresh pending reports alone', async (t) => {
    const now = 1_700_000_000_000;
    const reports = [
      {
        id: 'pending-stale',
        type: 'flash',
        body: VALID_REPORT_BODY,
        date: '2026-04-01',
        created_at: now - 10 * 60 * 1000,
        delivery_status: 'pending',
      },
      {
        id: 'pending-fresh',
        type: 'flash',
        body: VALID_REPORT_BODY,
        date: '2026-04-01',
        created_at: now - 2 * 60 * 1000,
        delivery_status: 'pending',
      },
      {
        id: 'failed-normal',
        type: 'flash',
        body: VALID_REPORT_BODY,
        date: '2026-04-01',
        created_at: now - 10 * 60 * 1000,
        delivery_status: 'failed',
      },
    ];

    const pool = {
      async query(text: string, values?: unknown[]) {
        if (text.includes('SELECT value FROM app_config WHERE key = $1')) {
          return { rows: [{ value: 'https://discord.com/api/webhooks/123/abc' }], rowCount: 1 };
        }

        if (text.includes('SELECT id, type, body, date FROM reports')) {
          const [dailyCutoff, defaultCutoff, stalePendingCutoff] = (values ?? []) as [number, number, number];
          const eligible = reports
            .filter((report) => {
              const statusOk =
                report.delivery_status === 'failed' ||
                (report.delivery_status === 'pending' && report.created_at < stalePendingCutoff);
              const windowOk =
                (report.type === 'daily' && report.created_at > dailyCutoff) ||
                (report.type !== 'daily' && report.created_at > defaultCutoff);
              return statusOk && windowOk;
            })
            .map(({ id, type, body, date }) => ({ id, type, body, date }));
          return { rows: eligible, rowCount: eligible.length };
        }

        if (text.includes("UPDATE reports SET delivery_status = 'pending'") && text.includes('RETURNING')) {
          return { rows: [{ delivery_status: 'pending' }], rowCount: 1 };
        }

        if (text.includes('UPDATE reports SET delivery_status = $1')) {
          const status = values?.[0] as string;
          const reportId = values?.[2] as string;
          const report = reports.find((entry) => entry.id === reportId);
          if (report) {
            report.delivery_status = status;
          }
          return { rows: [], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      },
    };

    const dateNowMock = t.mock.method(Date, 'now', () => now);
    const resolve4Mock = t.mock.method(dns.promises, 'resolve4', async () => ['104.16.60.37']);
    const resolve6Mock = t.mock.method(dns.promises, 'resolve6', async () => {
      throw new Error('no AAAA record');
    });
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));

    const config = {} as any;
    const { retryFailed } = createDelivery(pool as any, silentLog as any, config);
    const retried = await retryFailed();

    assert.strictEqual(retried, 2);
    assert.strictEqual(reports.find((report) => report.id === 'pending-stale')!.delivery_status, 'delivered');
    assert.strictEqual(reports.find((report) => report.id === 'pending-fresh')!.delivery_status, 'pending');
    assert.strictEqual(reports.find((report) => report.id === 'failed-normal')!.delivery_status, 'delivered');

    fetchMock.mock.restore();
    resolve4Mock.mock.restore();
    resolve6Mock.mock.restore();
    dateNowMock.mock.restore();
  });
});

describe('recoverStalePendingReports', () => {
  it('flips pending reports older than the stale threshold to failed', async (t) => {
    const now = 1_700_000_000_000;
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const pool = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values: values ?? [] });
        return { rows: [], rowCount: 2 };
      },
    };

    const dateNowMock = t.mock.method(Date, 'now', () => now);
    const recovered = await recoverStalePendingReports(pool as any, silentLog as any);

    assert.strictEqual(recovered, 2);
    assert.strictEqual(queries.length, 1);
    assert.match(queries[0]!.text, /UPDATE reports SET delivery_status = 'failed'/);
    assert.match(queries[0]!.text, /WHERE delivery_status = 'pending'/);
    assert.deepStrictEqual(queries[0]!.values, [now - 5 * 60 * 1000]);

    dateNowMock.mock.restore();
  });
});

// ---------------------------------------------------------------------------
// DL-010 — truncate() preserves UTF-16 surrogate pairs (cycle 92)
// ---------------------------------------------------------------------------

describe('truncate — UTF-16 surrogate pair safety (DL-010)', () => {
  it('backs up before a high surrogate at the cut point', () => {
    // '🚀' is a surrogate pair at positions 6-7. Slicing to 7 (10-3) would
    // land after the high surrogate. The fix backs up to 6.
    const result = truncate('Hello 🚀 world', 10);
    assert.strictEqual(result, 'Hello ...');
  });

  it('returns short text unchanged', () => {
    assert.strictEqual(truncate('abc', 10), 'abc');
  });

  it('returns text unchanged when exactly at limit', () => {
    assert.strictEqual(truncate('abcdefghij', 10), 'abcdefghij');
  });

  it('truncates 11-char ASCII string correctly', () => {
    assert.strictEqual(truncate('abcdefghijk', 10), 'abcdefg...');
  });

  it('truncates normally when emoji is not at the cut point', () => {
    // Emoji at the start, cut lands well after the pair
    const result = truncate('🚀 abcdefghijklmnop', 14);
    assert.strictEqual(result.length, 14);
    assert.ok(result.endsWith('...'));
    // Should not corrupt — no surrogate at cut boundary
    assert.ok(!result.includes('\uFFFD'), 'No replacement characters');
  });
});

// ---------------------------------------------------------------------------
// DL-011 — Retry-After capped at 60s with NaN guard (cycle 92)
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

describe('Retry-After cap — structural verification (DL-011)', () => {
  const webhookSrc = readFileSync(new URL('../../src/deliver/webhook.ts', import.meta.url), 'utf-8');

  it('defines MAX_RETRY_AFTER_MS = 60_000', () => {
    assert.ok(
      /MAX_RETRY_AFTER_MS\s*=\s*60[_]?000/.test(webhookSrc),
      'Expected MAX_RETRY_AFTER_MS constant equal to 60000',
    );
  });

  it('uses Number.isFinite for NaN guard', () => {
    assert.ok(webhookSrc.includes('Number.isFinite'), 'Expected Number.isFinite guard on Retry-After parsing');
  });

  it('uses Math.min to cap the retry value', () => {
    assert.ok(
      /Math\.min\b.*MAX_RETRY_AFTER_MS/.test(webhookSrc),
      'Expected Math.min(…, MAX_RETRY_AFTER_MS) to cap retry delay',
    );
  });
});

// ---------------------------------------------------------------------------
// DL-014 — Atomic idempotency via UPDATE...RETURNING (cycle 92)
// ---------------------------------------------------------------------------

describe('Atomic idempotency — structural verification (DL-014)', () => {
  const webhookSrc = readFileSync(new URL('../../src/deliver/webhook.ts', import.meta.url), 'utf-8');

  it('uses UPDATE reports … RETURNING instead of SELECT', () => {
    assert.ok(
      /UPDATE\s+reports[\s\S]*?RETURNING/i.test(webhookSrc),
      'Expected UPDATE reports … RETURNING for atomic idempotency',
    );
  });

  it('includes delivery_status != delivered in WHERE clause', () => {
    assert.ok(
      /delivery_status\s*!=\s*'delivered'/.test(webhookSrc),
      "Expected WHERE delivery_status != 'delivered' guard",
    );
  });
});
