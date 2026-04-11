import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type pg from 'pg';
import { insertItem } from '../../src/db/queries.js';

type Pool = pg.Pool;

function makeItem() {
  return {
    id: 'item-1',
    source: 'twitter',
    sourceId: 'source-1',
    author: 'alice',
    content: 'content',
    timestamp: 1_700_000_000_000,
    url: 'https://example.com/post',
    engagement: 42,
    contentHash: 'hash-1',
    status: 'ready',
    createdAt: 1_700_000_000_001,
  };
}

describe('insertItem', () => {
  it('returns inserted=true when the row is inserted', async () => {
    const pool = {
      query: async () => ({ rowCount: 1 }),
    } as unknown as Pool;

    const result = await insertItem(pool, makeItem());

    assert.deepStrictEqual(result, { inserted: true });
  });

  it('returns inserted=false when ON CONFLICT DO NOTHING skips the row', async () => {
    const pool = {
      query: async () => ({ rowCount: 0 }),
    } as unknown as Pool;

    const result = await insertItem(pool, makeItem());

    assert.deepStrictEqual(result, { inserted: false });
  });

  it('returns inserted=false on url unique violations', async () => {
    const pool = {
      query: async () => {
        throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
      },
    } as unknown as Pool;

    const result = await insertItem(pool, makeItem());

    assert.deepStrictEqual(result, { inserted: false });
  });

  it('rethrows unrelated database errors', async () => {
    const error = Object.assign(new Error('connection exception'), { code: '08001' });
    const pool = {
      query: async () => {
        throw error;
      },
    } as unknown as Pool;

    await assert.rejects(
      () => insertItem(pool, makeItem()),
      (err: unknown) => err === error,
    );
  });
});
