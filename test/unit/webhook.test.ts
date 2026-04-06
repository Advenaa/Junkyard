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
});

describe('buildEmbed — description truncation', () => {
  it('truncates description to 4096 chars', () => {
    const longTldr = 'A'.repeat(5000);
    const report = { id: 'test-1', type: 'daily', body: '{}', date: '2026-04-01' };
    const parsed = {
      tldr: longTldr,
      keyEvents: [],
      eventChains: [],
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
    assert.ok(url.includes('104.16.60.37'), 'Expected pinned IP in URL');

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
