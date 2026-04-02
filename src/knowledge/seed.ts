import { ulid } from 'ulid';
import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';
import { normalizeAlias } from './entities.js';

interface CoinGeckoEntry {
  id: string;
  symbol: string;
  name: string;
}

const INDONESIAN_ENTITIES = [
  {
    name: 'OJK',
    fullName: 'Otoritas Jasa Keuangan',
    type: 'company' as const,
    aliases: [
      'ojk',
      'otoritas jasa keuangan',
      'indonesia financial services authority',
    ],
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
    aliases: [
      'bei',
      'idx',
      'bursa efek indonesia',
      'indonesia stock exchange',
      'ihsg',
    ],
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
}

export function createSeeder(pool: Pool, log: Logger): Seeder {
  async function seedCoinGecko(): Promise<number> {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/coins/list',
      { signal: AbortSignal.timeout(15_000) },
    );

    if (!response.ok) {
      log.error(
        { status: response.status },
        `CoinGecko API returned ${response.status}`,
      );
      return 0;
    }

    const coins = (await response.json()) as CoinGeckoEntry[];
    const now = Date.now();
    let seeded = 0;

    for (const coin of coins) {
      const newId = ulid();
      const name = normalizeAlias(coin.name);

      const insertResult = await pool.query(
        `INSERT INTO entities (id, name, type, status, relevance, first_seen, last_seen)
         VALUES ($1, $2, 'token', 'active', 0, $3, $3)
         ON CONFLICT(name, type) DO NOTHING`,
        [newId, name, now],
      );

      // Fetch the entity id (could be new or existing)
      const fetchResult = await pool.query<{ id: string }>(
        "SELECT id FROM entities WHERE name = $1 AND type = 'token'",
        [name],
      );

      if (fetchResult.rows.length === 0) continue; // Should not happen, but safety check

      const entityId = fetchResult.rows[0].id;
      const isNew = (insertResult.rowCount ?? 0) > 0;

      // Insert 3 aliases: name, symbol, id
      const aliases = new Set([
        name,
        normalizeAlias(coin.symbol),
        normalizeAlias(coin.id),
      ]);

      for (const alias of aliases) {
        await pool.query(
          `INSERT INTO entity_aliases (alias, context_key, entity_id)
           VALUES ($1, '', $2)
           ON CONFLICT (alias, context_key) DO NOTHING`,
          [alias, entityId],
        );
      }

      if (isNew) seeded++;
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

      const fetchResult = await pool.query<{ id: string }>(
        'SELECT id FROM entities WHERE name = $1 AND type = $2',
        [name, entity.type],
      );

      if (fetchResult.rows.length === 0) continue;

      const entityId = fetchResult.rows[0].id;
      const isNew = (insertResult.rowCount ?? 0) > 0;

      for (const alias of entity.aliases) {
        await pool.query(
          `INSERT INTO entity_aliases (alias, context_key, entity_id)
           VALUES ($1, '', $2)
           ON CONFLICT (alias, context_key) DO NOTHING`,
          [normalizeAlias(alias), entityId],
        );
      }

      if (isNew) seeded++;
    }

    log.info({ seeded }, `Seeded ${seeded} Indonesian entities`);

    return seeded;
  }

  return { seedCoinGecko, seedIndonesian };
}
