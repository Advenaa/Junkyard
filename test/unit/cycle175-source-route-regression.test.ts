import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readServerSource } from './helpers/server-source.js';

let source: string;

before(async () => {
  source = readServerSource();
});

describe('Cycle 175 — source action routes support query-string sourceId', () => {
  it('defines a shared source target resolver for params/query sourceId', () => {
    assert.match(source, /function getSourceTargetFromRequest/, 'server.ts must define getSourceTargetFromRequest');
    assert.match(
      source,
      /const sourceId = params\.sourceId \?\? query\?\.sourceId;/,
      'source target resolver must fall back to querystring sourceId',
    );
  });

  it('registers PATCH /api/v1/sources/:source with querystring sourceId support', () => {
    assert.match(
      source,
      /app\.patch\(\s*'\/api\/v1\/sources\/:source'/,
      'server.ts must define PATCH /api/v1/sources/:source',
    );
    assert.match(
      source,
      /querystring:\s*sourceQuerySchema/,
      'PATCH source route must validate sourceId in querystring',
    );
  });

  it('registers DELETE /api/v1/sources/:source with querystring sourceId support', () => {
    assert.match(
      source,
      /app\.delete\(\s*'\/api\/v1\/sources\/:source'/,
      'server.ts must define DELETE /api/v1/sources/:source',
    );
    assert.match(
      source,
      /querystring:\s*sourceQuerySchema/,
      'DELETE source route must validate sourceId in querystring',
    );
  });
});
