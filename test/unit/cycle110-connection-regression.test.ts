import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// QR-001: Structural regression — BIGINT type parser in connection.ts
// ---------------------------------------------------------------------------

describe('QR-001: BIGINT type parser (structural)', () => {
  const src = readFileSync(new URL('../../src/db/connection.ts', import.meta.url), 'utf-8');

  it('imports pg from "pg"', () => {
    assert.match(src, /import\s+pg\s+from\s+['"]pg['"]/, 'connection.ts must import pg from "pg"');
  });

  it('calls pg.types.setTypeParser with OID 20', () => {
    assert.ok(
      src.includes('pg.types.setTypeParser(20'),
      'connection.ts must call pg.types.setTypeParser(20, ...) to parse BIGINT as number',
    );
  });

  it('parser function calls parseInt to convert string to number', () => {
    assert.ok(src.includes('parseInt('), 'BIGINT type parser must use parseInt to convert string values to numbers');
  });

  it('setTypeParser is called BEFORE new pg.Pool', () => {
    const setTypeParserPos = src.indexOf('pg.types.setTypeParser(20');
    const newPoolPos = src.indexOf('new pg.Pool');

    assert.ok(setTypeParserPos > -1, 'pg.types.setTypeParser(20, ...) must exist');
    assert.ok(newPoolPos > -1, 'new pg.Pool must exist');
    assert.ok(
      setTypeParserPos < newPoolPos,
      'pg.types.setTypeParser must be called BEFORE new pg.Pool — ' +
        `setTypeParser at ${setTypeParserPos}, new Pool at ${newPoolPos}`,
    );
  });
});
