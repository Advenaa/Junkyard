import { ulid } from 'ulid';
import type { Pool } from '../db/connection.js';
import { upsertEntityRelationship } from '../db/queries.js';
import type { Logger } from '../logger.js';
import { COMPETITOR_SEEDS } from './competitor-seeds.js';
import { normalizeAlias } from './entities.js';

interface CoinGeckoEntry {
  id: string;
  symbol: string;
  name: string;
  /** Present when fetched from /coins/markets; absent from /coins/list. */
  market_cap_rank?: number | null;
}

/**
 * Well-known top crypto symbols that should get an empty context_key so they
 * resolve without context during Tier 1 alias lookup.  The /coins/list endpoint
 * does NOT return market_cap_rank, so we use a hardcoded set instead.
 */
const TOP_SYMBOLS = new Set([
  'btc',
  'eth',
  'usdt',
  'usdc',
  'bnb',
  'xrp',
  'sol',
  'ada',
  'doge',
  'trx',
  'ton',
  'link',
  'avax',
  'shib',
  'dot',
  'bch',
  'dai',
  'ltc',
  'leo',
  'uni',
  'near',
  'apt',
  'matic',
  'atom',
  'icp',
  'xlm',
  'etc',
  'vet',
  'fil',
  'hbar',
  'arb',
  'op',
  'mkr',
  'aave',
  'grt',
  'algo',
  'ftm',
  'inj',
  'rune',
  'theta',
  'axs',
  'sand',
  'mana',
  'ldo',
  'snx',
  'crv',
  'ape',
  'comp',
  'sushi',
  'yfi',
]);

const INDONESIAN_ENTITIES = [
  {
    name: 'OJK',
    fullName: 'Otoritas Jasa Keuangan',
    type: 'company' as const,
    aliases: ['ojk', 'otoritas jasa keuangan', 'indonesia financial services authority'],
  },
  {
    name: 'Bappebti',
    fullName: 'Badan Pengawas Perdagangan Berjangka Komoditi',
    type: 'company' as const,
    aliases: ['bappebti', 'commodity futures trading regulatory agency'],
  },
  {
    name: 'Bank Indonesia',
    fullName: 'Bank Indonesia',
    type: 'company' as const,
    aliases: ['bank indonesia', 'bi', 'central bank of indonesia'],
  },
  {
    name: 'BEI',
    fullName: 'Bursa Efek Indonesia',
    type: 'company' as const,
    aliases: ['bei', 'idx', 'bursa efek indonesia', 'indonesia stock exchange', 'ihsg'],
  },
  {
    name: 'Indodax',
    fullName: 'Indodax',
    type: 'company' as const,
    aliases: ['indodax'],
  },
  {
    name: 'Tokocrypto',
    fullName: 'Tokocrypto',
    type: 'company' as const,
    aliases: ['tokocrypto', 'tko'],
  },
  {
    name: 'Pintu',
    fullName: 'Pintu',
    type: 'company' as const,
    aliases: ['pintu'],
  },
  {
    name: 'Rupiah',
    fullName: 'Indonesian Rupiah',
    type: 'token' as const,
    aliases: ['rupiah', 'idr', 'indonesian rupiah'],
  },
];

interface Seeder {
  seedCoinGecko(): Promise<number>;
  seedIndonesian(): Promise<number>;
  seedCompetitorRelationships(): Promise<number>;
}

export function createSeeder(pool: Pool, log: Logger): Seeder {
  async function seedCoinGecko(): Promise<number> {
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 2_000;
    let coins: CoinGeckoEntry[] | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch('https://api.coingecko.com/api/v3/coins/list', {
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
          throw new Error(`CoinGecko API returned ${response.status}`);
        }

        coins = (await response.json()) as CoinGeckoEntry[];
        break;
      } catch (err: unknown) {
        const isLastAttempt = attempt === MAX_RETRIES;
        if (isLastAttempt) {
          log.warn(
            { err, attempts: MAX_RETRIES },
            'CoinGecko seeding failed after all retries — entity resolution for crypto tokens will fall back to LLM disambiguation',
          );
          throw err instanceof Error ? err : new Error(String(err));
        }
        const delayMs = BASE_DELAY_MS * 2 ** (attempt - 1);
        log.info(
          { err, attempt, nextRetryMs: delayMs },
          `CoinGecko fetch failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delayMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    if (!coins) {
      throw new Error('CoinGecko seeding failed: no coin list returned');
    }
    const now = Date.now();
    let seeded = 0;

    const BATCH_SIZE = 500;
    const batches: CoinGeckoEntry[][] = [];
    for (let i = 0; i < coins.length; i += BATCH_SIZE) {
      batches.push(coins.slice(i, i + BATCH_SIZE));
    }

    for (const batch of batches) {
      // 1. Batch insert entities
      const entityValues: unknown[] = [];
      const entityPlaceholders: string[] = [];
      for (let i = 0; i < batch.length; i++) {
        const coin = batch[i];
        const name = normalizeAlias(coin.name);
        const id = ulid();
        const offset = i * 3;
        entityPlaceholders.push(
          `($${offset + 1}, $${offset + 2}, 'token', 'active', 0, $${offset + 3}, $${offset + 3})`,
        );
        entityValues.push(id, name, now);
      }

      const insertResult = await pool.query<{ name: string }>(
        `INSERT INTO entities (id, name, type, status, relevance, first_seen, last_seen)
         VALUES ${entityPlaceholders.join(', ')}
         ON CONFLICT(name, type) DO NOTHING
         RETURNING name`,
        entityValues,
      );
      seeded += insertResult.rowCount ?? 0;

      // 2. Batch fetch entity IDs for alias mapping
      const names = batch.map((c) => normalizeAlias(c.name));
      const namePlaceholders = names.map((_, i) => `$${i + 1}`).join(', ');
      const fetchResult = await pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM entities WHERE type = 'token' AND name IN (${namePlaceholders})`,
        names,
      );

      const nameToId = new Map<string, string>();
      for (const row of fetchResult.rows) {
        nameToId.set(row.name, row.id);
      }

      // 3. Batch insert aliases
      const aliasValues: unknown[] = [];
      const aliasPlaceholders: string[] = [];
      let aliasIdx = 0;

      for (const coin of batch) {
        const name = normalizeAlias(coin.name);
        const entityId = nameToId.get(name);
        if (!entityId) continue;

        const symbolAlias = normalizeAlias(coin.symbol);
        // Top-100 tokens get empty context_key for their symbol (most likely match).
        // Others get a contextualized key so multiple entities can share the same
        // symbol without the first-seeded winning arbitrarily.
        const symbolContextKey = TOP_SYMBOLS.has(symbolAlias) ? '' : `coingecko:${coin.id}`;

        // Name and CoinGecko slug aliases always use empty context_key
        // (they are already unique enough).
        const plainAliases = new Set([name, normalizeAlias(coin.id)]);

        for (const alias of plainAliases) {
          if (!alias) continue;
          const offset = aliasIdx * 6;
          aliasPlaceholders.push(
            `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`,
          );
          aliasValues.push(ulid(), entityId, alias, '', 'seed', now);
          aliasIdx++;
        }

        // Insert symbol alias separately with its context_key
        if (symbolAlias && !plainAliases.has(symbolAlias)) {
          const offset = aliasIdx * 6;
          aliasPlaceholders.push(
            `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`,
          );
          aliasValues.push(ulid(), entityId, symbolAlias, symbolContextKey, 'seed', now);
          aliasIdx++;
        }
      }

      if (aliasPlaceholders.length > 0) {
        await pool.query(
          `INSERT INTO entity_aliases (id, entity_id, alias, context_key, origin, created_at)
           VALUES ${aliasPlaceholders.join(', ')}
           ON CONFLICT (alias, context_key) DO NOTHING`,
          aliasValues,
        );
      }
    }

    log.info({ seeded }, `Seeded ${seeded} entities from CoinGecko`);

    return seeded;
  }

  async function seedIndonesian(): Promise<number> {
    const now = Date.now();
    let seeded = 0;

    for (const entity of INDONESIAN_ENTITIES) {
      const newId = ulid();
      const name = normalizeAlias(entity.name);

      const insertResult = await pool.query(
        `INSERT INTO entities (id, name, type, status, relevance, first_seen, last_seen)
         VALUES ($1, $2, $3, 'active', 0, $4, $4)
         ON CONFLICT(name, type) DO NOTHING`,
        [newId, name, entity.type, now],
      );

      const fetchResult = await pool.query<{ id: string }>('SELECT id FROM entities WHERE name = $1 AND type = $2', [
        name,
        entity.type,
      ]);

      if (fetchResult.rows.length === 0) continue;

      const entityId = fetchResult.rows[0].id;
      const isNew = (insertResult.rowCount ?? 0) > 0;

      for (const alias of entity.aliases) {
        await pool.query(
          `INSERT INTO entity_aliases (id, entity_id, alias, context_key, origin, created_at)
           VALUES ($1, $2, $3, '', 'seed', $4)
           ON CONFLICT (alias, context_key) DO NOTHING`,
          [ulid(), entityId, normalizeAlias(alias), now],
        );
      }

      if (isNew) seeded++;
    }

    log.info({ seeded }, `Seeded ${seeded} Indonesian entities`);

    return seeded;
  }

  async function seedCompetitorRelationships(): Promise<number> {
    const preferredNames = [
      ...new Set(COMPETITOR_SEEDS.flatMap((seed) => [seed.entityA, seed.entityB]).map(normalizeAlias)),
    ];
    const entityIdByLookup = new Map<string, string>();

    if (preferredNames.length > 0) {
      const exactMatches = await pool.query<{ id: string; lookup_key: string }>(
        `SELECT id, LOWER(name) AS lookup_key
           FROM entities
          WHERE LOWER(name) = ANY($1)`,
        [preferredNames],
      );

      for (const row of exactMatches.rows) {
        entityIdByLookup.set(row.lookup_key, row.id);
      }

      const unresolved = preferredNames.filter((name) => !entityIdByLookup.has(name));
      if (unresolved.length > 0) {
        const aliasMatches = await pool.query<{ id: string; lookup_key: string }>(
          `SELECT DISTINCT ON (ea.alias)
              ea.entity_id AS id,
              ea.alias AS lookup_key
             FROM entity_aliases ea
             JOIN entities e ON e.id = ea.entity_id
            WHERE ea.alias = ANY($1)
            ORDER BY ea.alias, (e.status = 'active') DESC, (ea.context_key = '') DESC, ea.context_key, ea.entity_id`,
          [unresolved],
        );

        for (const row of aliasMatches.rows) {
          entityIdByLookup.set(row.lookup_key, row.id);
        }
      }
    }

    let seeded = 0;
    let skipped = 0;

    for (const seed of COMPETITOR_SEEDS) {
      const entityIdA = entityIdByLookup.get(normalizeAlias(seed.entityA));
      const entityIdB = entityIdByLookup.get(normalizeAlias(seed.entityB));

      if (!entityIdA || !entityIdB || entityIdA === entityIdB) {
        skipped++;
        continue;
      }

      await upsertEntityRelationship(pool, entityIdA, entityIdB, seed.type, 0.85, 'manual');
      seeded++;
    }

    log.info({ seeded, skipped }, `Seeded ${seeded} competitor relationships`);
    return seeded;
  }

  return { seedCoinGecko, seedIndonesian, seedCompetitorRelationships };
}
