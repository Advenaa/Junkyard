# Entity Resolution

Reference for how Podders v2 resolves, tracks, and prunes entities across sources.

## Resolution Algorithm

Stage 1 (Haiku) extracts entities from each chunk as `{ name, aliases[], type }`. The resolution layer maps these to canonical rows in `entities` via `entity_aliases`.

### Alias Lookup-Then-Insert

```
for each extracted entity (name, aliases, type):
    canonical = lowercase(name)
    entity_id = SELECT entity_id FROM entity_aliases WHERE alias = canonical

    if entity_id is NULL:
        -- Check if an archived entity has a matching alias (EL-015 fix)
        entity_id = SELECT e.id FROM entities e
            JOIN entity_aliases ea ON ea.entity_id = e.id
            WHERE ea.alias = canonical AND e.status = 'archived'
            LIMIT 1
        if entity_id is NOT NULL:
            -- Reactivate archived entity with history intact
            UPDATE entities SET status = 'active', relevance = 0.5 WHERE id = entity_id
        else:
            entity_id = new ULID
            INSERT INTO entities (id, name, type, relevance, status, first_seen, last_seen)
                VALUES (entity_id, name, type, 0, 'active', now, now)
                ON CONFLICT (name, type) DO UPDATE SET last_seen = now
                RETURNING id
            -- Atomic: returns the inserted id OR the existing row's id (SD-003 fix).
            -- No separate SELECT needed, no race window between INSERT and SELECT.
        INSERT ... ON CONFLICT DO NOTHING INTO entity_aliases (alias, entity_id) VALUES (canonical, entity_id)

    for each alias in aliases:
        normalized = trim(lowercase(strip_prefix('$', alias)))
        INSERT ... ON CONFLICT DO NOTHING INTO entity_aliases (alias, entity_id) VALUES (normalized, entity_id)

    UPDATE entities SET last_seen = now, relevance = <decay formula> WHERE id = entity_id
    INSERT entity_mention row
```

All aliases are **trimmed and lowercased** before storage (`normalizeAlias` applies `.trim().toLowerCase().replace(/^\$/, '')`). The `$` prefix (common in crypto tickers like `$ETH`) is stripped so that `$ETH`, `ETH`, and `eth` all resolve to the same alias key.

Reactivation via alias match (EL-015 fix): the archived entity check now joins `entity_aliases` instead of matching on `name + type` alone. This catches cases where the LLM returns a different surface form (e.g., "ETH" instead of "Ethereum") -- if any alias of the archived entity matches the normalized canonical name, the entity is reactivated at `relevance = 0.5` rather than creating a duplicate.

`INSERT ... ON CONFLICT DO UPDATE ... RETURNING id` is the concurrency pattern for entities. The upsert atomically returns the row ID whether inserted or already existing -- no race window between a separate INSERT and SELECT (SD-003 fix). For aliases, `INSERT ... ON CONFLICT DO NOTHING` is still used: two Stage 1 batches processing simultaneously may both try to insert the same alias; the first writer wins, the second silently skips.

## CoinGecko Seeding

The alias table is pre-populated from CoinGecko's public token list so that common tokens resolve immediately without waiting for LLM extraction.

### Fetch

```
GET https://api.coingecko.com/api/v3/coins/list
```

Returns `[{ id: "ethereum", symbol: "eth", name: "Ethereum" }, ...]`. No API key required for this endpoint.

### Seed Logic

For each coin in the response:

1. Create an entity with `name = coin.name`, `type = 'token'`, `relevance = 0`.
2. Insert aliases: `lowercase(coin.name)`, `lowercase(coin.symbol)`, `lowercase(coin.id)`.
3. Skip duplicates via `INSERT ... ON CONFLICT DO NOTHING` (symbol collisions are common -- multiple tokens share `"uni"`, `"sol"`, etc.). First writer wins.
4. **Non-top-100 tokens** (EL-011 fix): tokens outside the CoinGecko top-100 by market cap insert their symbol alias with `context_key = 'coingecko:<coin.id>'` instead of a bare alias. This prevents obscure tokens from claiming common symbols (e.g., a micro-cap "SOL" token stealing the `sol` alias from Solana). Top-100 tokens still insert bare symbol aliases as before. The `context_key` column on `entity_aliases` scopes the alias so it only resolves when the same context is present -- otherwise Tier 2/3 disambiguation handles it.

### Refresh Cadence

Run on first startup if the `entities` table is empty. Re-seed weekly via the daily cron (check `last_coingecko_seed` in `app_config`). New tokens get inserted; existing aliases are untouched.

### Indonesian Entity Seeds

In addition to CoinGecko tokens, seed Indonesian regulatory bodies and exchanges on first startup:

| Entity | Type | Aliases |
|--------|------|---------|
| OJK | company | ojk, otoritas jasa keuangan |
| Bappebti | company | bappebti |
| Bank Indonesia | company | bank indonesia, bi (context: Indonesian finance) |
| Bursa Efek Indonesia | company | bei, idx, bursa efek indonesia |
| Indodax | company | indodax |
| Tokocrypto | company | tokocrypto, tko |
| Pintu | company | pintu |
| Indonesian Rupiah | token | idr, rupiah |

**"BI" disambiguation**: "BI" maps to Bank Indonesia by default. In crypto-heavy context, Haiku may return "BI" meaning Binance — the alias resolution prefers the existing mapping. If Haiku returns `{ name: "Binance", aliases: ["BI"] }`, the `INSERT ... ON CONFLICT DO NOTHING` on "bi" keeps the Bank Indonesia mapping. Binance resolves via its own aliases ("binance", "bnb"). Acceptable trade-off for Indonesian market focus.

## Entity Types

The `type` column is a text enum:

| Type | Use for | Examples |
|------|---------|----------|
| `token` | Fungible tokens, coins, stablecoins | Ethereum, Bitcoin, USDC |
| `person` | Named individuals | Vitalik Buterin, CZ |
| `project` | Protocols, DAOs, L2s, dApps | Uniswap, Aave, Arbitrum |
| `company` | Corporate entities, firms, exchanges | Coinbase, a16z, OpenZeppelin |
| `event` | Named events, conferences, exploits | Token2049, Euler exploit |

### Ambiguity Rules

- If unsure, default to `project` (instruction in Stage 1 prompt).
- An L1/L2 chain that also has a token: use `project` (Ethereum the network, not ETH the asset). The token alias still resolves to it.
- An exchange that is also a company (Coinbase): use `company`.
- A named hack or exploit: use `event`.

### UNIQUE(name, type) Constraint

The `entities` table has `UNIQUE(name, type)`, which means "Mercury" can exist as both a `token` and a `company`. Different canonical entities, different IDs, different alias sets. The LLM's `type` assignment determines which one a mention resolves to. If the LLM is inconsistent (calling Mercury a `token` in one chunk and `company` in another), they become two separate entities -- see the merge procedure below.

## Relevance Decay

Relevance tracks how "hot" an entity is. Updated on every mention and decayed daily.

### Formula

```
relevance = relevance * 0.95^days_since_update + log(1 + mentions) * source_weight
```

The daily decay applies a flat 5% reduction: `relevance = relevance * 0.95`. Mention boosts happen in real time during Stage 1 processing, weighted by source type:

| Source | Weight | Rationale |
|--------|--------|-----------|
| News | 2.0 | Rarest and highest signal — a news mention is editorially curated |
| Twitter | 1.5 | Moderate signal — public but noisy |
| Discord | 1.0 (base) | Highest volume, most noise |

News is weighted highest because news mentions are rarest and highest signal. Discord is lowest because volume is highest and noise is greatest.

### Concrete Examples

| Scenario | Relevance | Interpretation |
|----------|-----------|----------------|
| Mentioned 50x across Discord+Twitter today | ~8.0 | Very active, will appear in correlations |
| Mentioned 5x in Discord yesterday, nothing today | ~2.6 | Moderately relevant, decaying |
| Not mentioned for 7 days, was at 2.0 | ~1.4 | Fading -- `2.0 * 0.95^7` |
| Not mentioned for 30 days, was at 2.0 | ~0.43 | Nearly dormant |
| Not mentioned for 90 days, was at 2.0 | ~0.02 | Approaching prune threshold |
| Relevance = 0.5 | | Entity was recently active but thinning out |
| Relevance = 0.01 | | Effectively dead -- prune candidate |

### Daily Decay Cron

Runs at **00:10 UTC** (referenced in DEPLOYMENT.md), after the daily report cron completes.

```sql
BEGIN;
UPDATE entities SET relevance = relevance * 0.95
WHERE status = 'active' AND relevance > 0.01
FOR UPDATE;
COMMIT;
```

The decay runs inside an explicit `BEGIN`/`FOR UPDATE`/`COMMIT` transaction to prevent races with concurrent relevance updates from Stage 1 processing (SD-002 fix). The `WHERE status = 'active'` filter ensures only active entities are decayed. The `relevance > 0.01` guard skips entities already below the archive threshold, avoiding unnecessary writes and keeping near-zero values from decaying to infinitesimally small numbers. Applied daily. Mention-driven boosts happen in real time during Stage 1 processing.

## Archival and Reactivation

Entities are never hard-deleted. Instead, they demote to `status = 'archived'` and can be promoted back to `'active'` when re-mentioned with full history intact.

### Archival Rule

An entity is archived when **all three** conditions are true:

- `relevance < 0.01`
- `last_seen < now - 90 days`
- No mentions in `entity_mentions` within the last 30 days (EL-002 fix)

```sql
UPDATE entities SET status = 'archived'
WHERE relevance < 0.01
  AND last_seen < NOW() - INTERVAL '90 days'
  AND status = 'active'
  AND id NOT IN (
    SELECT DISTINCT entity_id FROM entity_mentions
    WHERE created_at > NOW() - INTERVAL '30 days'
  );
```

The triple condition prevents archiving a low-relevance entity that was just re-discovered (new `last_seen`), a stale entity that still has residual relevance from high historical activity, or an entity that has recent mentions even if `last_seen` was not updated due to a processing gap (EL-002 fix). The mention check acts as a safety net: if an entity was mentioned recently but its `last_seen` timestamp was not refreshed (e.g., due to a failed Stage 1 batch), the entity is preserved.

### What's Preserved When Archived

- Entity name, type, all alias mappings in `entity_aliases`
- Last known relevance (before it decayed to threshold)
- Last seen timestamp, first seen timestamp
- All `entity_mentions` rows (subject to normal mention retention cron)

Archived entities do **not** appear in correlations or reports (`WHERE status = 'active'`). They **do** appear in chat/search results (no status filter).

### Reactivation

When an archived entity is re-mentioned (detected during the alias lookup-then-insert flow in Stage 1):

```sql
UPDATE entities SET status = 'active', relevance = 0.5 WHERE id = $1 AND status = 'archived';
```

The entity restarts at `relevance = 0.5` (mid-level, not zero) so it immediately contributes to correlations. All historical aliases and mentions are still linked -- no context is lost.

### Why Not Delete?

Hard-deleting entities loses all context. If CZ disappears for 90 days and is then re-mentioned, the system would treat him as brand new -- no aliases, no mention history, no sentiment baseline. Archival preserves history for entities that return to relevance.

## Three-Tier Disambiguation

Entity disambiguation uses three tiers, each progressively more expensive. Most entities resolve at Tier 1 (free). Ambiguous names escalate through tiers automatically.

### Tier 1: Rule-Based Alias Lookup (free)

The same entity appears differently across sources:

| Source | Raw text | Normalized alias |
|--------|----------|------------------|
| Discord | `ETH` | `eth` |
| Twitter | `$ETH` | `eth` (strip `$`) |
| News | `Ethereum` | `ethereum` |

All three resolve to the same canonical entity because the alias table maps `eth` and `ethereum` to the same `entity_id`. CoinGecko seeding pre-populates both the symbol (`eth`) and name (`ethereum`) as aliases.

For non-seeded entities, the LLM's `aliases` array in Stage 1 output builds the mapping. When Haiku processes a Discord chunk and returns `{ name: "Uniswap", aliases: ["UNI", "$UNI"] }`, it inserts `uniswap`, `uni` as aliases. A later Twitter chunk referencing `$UNI` strips the `$`, finds `uni` in the alias table, and resolves to the same entity.

Handles ~95% of entities instantly.

### Tier 2: Co-occurrence Graph Lookup (free)

Triggered when an entity has **no alias match at all** (not when multiple candidates exist). If other entities from the same batch already resolved at Tier 1, Tier 2 uses those resolved entities to search the co-occurrence graph for the unknown name.

The algorithm queries `entity_aliases` joined with `entity_mentions` to find all aliases that have historically appeared alongside the already-resolved entities (i.e., shared a `summary_id`). This builds a map using a **composite key of `alias + ':' + entity type`** (EL-010 fix) so that the same alias appearing for different entity types does not collide. Each unresolved entity's lowercased name combined with its type is then looked up in that map with a single `Map.get()` call -- no scoring, no threshold.

```typescript
if (unresolvedEntities.length > 0 && resolvedIds.length > 0) {
  // Find all aliases that co-occur with already-resolved entities
  // Include entity type for type-aware composite key (EL-010 fix)
  const coOccurring = await client.query(`
    SELECT DISTINCT ea.alias, ea.entity_id, e.type
    FROM entity_aliases ea
    JOIN entity_mentions em ON em.entity_id = ea.entity_id
    JOIN entities e ON e.id = ea.entity_id
    WHERE em.summary_id IN (
      SELECT summary_id FROM entity_mentions WHERE entity_id = ANY($1)
    )
  `, [resolvedIds]);

  const coOccurMap = new Map<string, string>();
  for (const row of coOccurring.rows) {
    // Composite key: alias + type prevents cross-type misresolution
    coOccurMap.set(`${row.alias}:${row.type}`, row.entity_id);
  }

  for (const entity of unresolvedEntities) {
    const canonical = entity.name.toLowerCase();
    // Try type-specific match first, then fall back to any-type match
    const matched = coOccurMap.get(`${canonical}:${entity.type}`);

    if (matched) {
      resolvedIds.push(matched); // grows the resolved set for subsequent lookups
      entityIdMap.set(entity, matched);
    } else {
      stillUnresolved.push(entity); // falls through to Tier 3
    }
  }
}
```

Example: a batch mentions "Wormhole" (no alias match) alongside "Solana" and "USDC" (both resolved at Tier 1). Tier 2 finds that the alias `wormhole` exists in the co-occurrence graph of Solana/USDC mentions and resolves it directly. If "Wormhole" does not appear in the graph, it falls through to Tier 3.

### Tier 3: Batched LLM Disambiguation (~$0.01/day)

Entities still ambiguous after Tier 2 are collected across the entire processing cycle and resolved in a single batched Haiku call:

```typescript
const prompt = ambiguousEntities.map((e, i) =>
  `${i+1}. "${e.name}" in context: "${e.surroundingText.slice(0, 200)}"
  Candidates: ${e.candidates.map(c => `${c.name} (${c.type})`).join(', ')}`
).join('\n\n');

const response = await llm.call({
  model: config.models.normalizer,
  system: 'For each ambiguous entity mention, select the correct candidate based on context. Output JSON array: [{"index": 1, "selected": "candidate name"}]',
  prompt,
  maxTokens: ambiguousEntities.length * 50,
  stage: 'entity-disambiguate'
});
```

Each disambiguation result is saved as a context-aware alias (`entity_aliases` with `context_key`), so future lookups with the same alias in the same context resolve at Tier 1. The system is self-improving: Day 1 may see 5-10 LLM calls, but by Month 2 most ambiguities resolve via cached context aliases.

### Edge Cases

- **Name collision across types**: "Mercury" as a token and "Mercury" as a company are separate entities with separate alias sets. The alias `mercury` can only point to one. First writer wins. If the company is seeded first, Discord messages about the Mercury token saying just "Mercury" will misresolve. Mitigation: context-aware aliases (Tier 2/3) can map "mercury" + DeFi context to the token and "mercury" + company context to the company. When misresolution is detected, use the merge procedure or manually reassign the alias.

- **Ticker collision**: Multiple tokens share `sol`, `uni`, etc. CoinGecko seeding inserts the first match. Later tokens with the same symbol are skipped (`INSERT ... ON CONFLICT DO NOTHING`). Context-aware aliases from Tier 3 can differentiate when co-occurring entities provide enough signal.

- **Alias hijacking**: A new entity could claim an alias that belongs to an existing entity. `INSERT ... ON CONFLICT DO NOTHING` prevents this -- existing aliases are never overwritten. To reassign an alias, delete it first, then re-insert.

- **Self-improvement decay**: Context aliases accumulate over time. No cleanup needed -- alias lookups are indexed and the table stays small relative to items/mentions.

## Sentiment Momentum

Entity sentiment is tracked daily and used to classify momentum trends. This feeds into Stage 3 synthesis and the market pulse.

### Daily Rollup

A daily cron (runs after the decay cron at **00:15 UTC**) aggregates sentiment from `entity_mentions` into the `entity_sentiment_daily` table:

```sql
INSERT INTO entity_sentiment_daily (entity_id, date, avg_sentiment, mention_count, source_breakdown)
SELECT
    em.entity_id,
    DATE(em.created_at) AS date,
    AVG(em.sentiment) AS avg_sentiment,
    COUNT(*) AS mention_count,
    jsonb_object_agg(em.source_type, source_counts.cnt) AS source_breakdown
FROM entity_mentions em
JOIN (
    SELECT entity_id, source_type, COUNT(*) AS cnt
    FROM entity_mentions
    WHERE created_at >= CURRENT_DATE - INTERVAL '1 day' AND created_at < CURRENT_DATE
    GROUP BY entity_id, source_type
) source_counts USING (entity_id, source_type)
WHERE em.created_at >= CURRENT_DATE - INTERVAL '1 day' AND em.created_at < CURRENT_DATE
GROUP BY em.entity_id, DATE(em.created_at)
ON CONFLICT (entity_id, date) DO UPDATE SET
    avg_sentiment = EXCLUDED.avg_sentiment,
    mention_count = EXCLUDED.mention_count,
    source_breakdown = EXCLUDED.source_breakdown;
```

### Momentum Calculation

Momentum compares the trailing 3-day average sentiment against the trailing 14-day average:

```
momentum = avg_sentiment_3d - avg_sentiment_14d
```

### Trend Classification

| Momentum Range | Classification | Interpretation |
|----------------|---------------|----------------|
| > 0.15 | `bullish_surge` | Rapid positive shift |
| 0.05 to 0.15 | `bullish` | Steady positive trend |
| -0.05 to 0.05 | `neutral` | No clear direction |
| -0.15 to -0.05 | `bearish` | Steady negative trend |
| < -0.15 | `bearish_crash` | Rapid negative shift |

Trend classifications are available via `GET /api/v1/entities/:id/sentiment` and included in Stage 3 synthesis context for entities with `relevance > 1.0`.

### Retention

The `entity_sentiment_daily` table is pruned at **365 days** (EL-014 fix). The retention cron runs daily alongside the decay cron:

```sql
DELETE FROM entity_sentiment_daily WHERE date < CURRENT_DATE - INTERVAL '365 days';
```

This keeps a full year of sentiment history for trend analysis while preventing unbounded table growth. Older sentiment data is not needed -- the 14-day momentum window and monthly reports use at most 30 days of lookback.

## Merge Procedure

When two entities are discovered to be duplicates (e.g., the LLM created both "Ethereum" as `token` and "Ethereum" as `project`), merge them manually or via a future admin endpoint.

### Steps

Given a **survivor** entity (keep) and a **duplicate** entity (delete):

```sql
BEGIN TRANSACTION;

-- 1. Move aliases from duplicate to survivor
UPDATE entity_aliases SET entity_id = :survivor_id WHERE entity_id = :duplicate_id;

-- 2. Reassign mentions from duplicate to survivor
UPDATE entity_mentions SET entity_id = :survivor_id WHERE entity_id = :duplicate_id;

-- 3. Update survivor metadata
UPDATE entities SET
    relevance = MAX(
        (SELECT relevance FROM entities WHERE id = :survivor_id),
        (SELECT relevance FROM entities WHERE id = :duplicate_id)
    ),
    first_seen = MIN(
        (SELECT first_seen FROM entities WHERE id = :survivor_id),
        (SELECT first_seen FROM entities WHERE id = :duplicate_id)
    ),
    last_seen = MAX(
        (SELECT last_seen FROM entities WHERE id = :survivor_id),
        (SELECT last_seen FROM entities WHERE id = :duplicate_id)
    )
WHERE id = :survivor_id;

-- 4. Delete the duplicate
DELETE FROM entities WHERE id = :duplicate_id;

COMMIT;
```

Choose the survivor by: prefer the entity with more mentions, or the one with the correct `type`. The survivor keeps its `name` and `type` -- update those manually if the duplicate had the better canonical form.

The alias `PRIMARY KEY` constraint means step 1 will fail if both entities share an alias (shouldn't happen, but guard with `ON CONFLICT DO NOTHING` if automating). Mention reassignment in step 2 is safe because `entity_mentions.id` is unique per row, not per entity.
