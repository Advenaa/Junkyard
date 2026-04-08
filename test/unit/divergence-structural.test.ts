/**
 * Structural regression tests for Regional Divergence (feature 2.7).
 *
 * Reads src/db/queries.ts and src/server.ts as strings and verifies:
 * - getEntityDivergence and getTopDivergentEntities functions exist and are exported
 * - EntityDivergenceRow type is exported
 * - Queries filter by entity_id, created_at range, and language
 * - Both 'eng' and 'ind' language values are referenced
 * - Routes /api/v1/divergence and /api/v1/entities/:entityId/divergence exist
 * - Both routes use authPreHandler
 * - Responses include divergence data
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

// ═══════════════════════════════════════════════════════════════════════
// queries.ts — divergence query functions
// ═══════════════════════════════════════════════════════════════════════

describe('Regional Divergence queries (src/db/queries.ts)', () => {
  const src = readSrc('src/db/queries.ts');

  it('exports getEntityDivergence function', () => {
    assert.match(
      src,
      /export\s+(async\s+)?function\s+getEntityDivergence\s*\(/,
      'getEntityDivergence must be an exported function',
    );
  });

  it('exports getTopDivergentEntities function', () => {
    assert.match(
      src,
      /export\s+(async\s+)?function\s+getTopDivergentEntities\s*\(/,
      'getTopDivergentEntities must be an exported function',
    );
  });

  it('exports EntityDivergenceRow type', () => {
    assert.match(
      src,
      /export\s+(interface|type)\s+EntityDivergenceRow\b/,
      'EntityDivergenceRow must be an exported type or interface',
    );
  });

  it('EntityDivergenceRow includes engSentiment, indSentiment, and divergence fields', () => {
    // Find the EntityDivergenceRow definition
    const typeStart = src.indexOf('EntityDivergenceRow');
    assert.ok(typeStart !== -1, 'EntityDivergenceRow must exist');

    // Grab a reasonable slice that covers the type definition
    const typeSlice = src.slice(typeStart, typeStart + 400);

    assert.ok(typeSlice.includes('engSentiment'), 'EntityDivergenceRow must have engSentiment field');
    assert.ok(typeSlice.includes('indSentiment'), 'EntityDivergenceRow must have indSentiment field');
    assert.ok(typeSlice.includes('divergence'), 'EntityDivergenceRow must have divergence field');
  });

  it('getEntityDivergence query filters by entity_id parameter', () => {
    const fnStart = src.indexOf('function getEntityDivergence');
    assert.ok(fnStart !== -1, 'getEntityDivergence must exist');
    const fnSlice = src.slice(fnStart, fnStart + 1500);

    assert.ok(
      fnSlice.includes('entity_id') || fnSlice.includes('entityId'),
      'getEntityDivergence query must filter by entity_id',
    );
  });

  it('getEntityDivergence query filters by created_at range', () => {
    const fnStart = src.indexOf('function getEntityDivergence');
    assert.ok(fnStart !== -1, 'getEntityDivergence must exist');
    const fnSlice = src.slice(fnStart, fnStart + 1500);

    assert.ok(fnSlice.includes('created_at'), 'getEntityDivergence query must reference created_at');
    // Should have both >= and <= (or BETWEEN) for range filtering
    assert.ok(
      (fnSlice.includes('>=') && fnSlice.includes('<=')) || fnSlice.includes('BETWEEN'),
      'getEntityDivergence query must filter created_at with a range (>= and <= or BETWEEN)',
    );
  });

  it('getEntityDivergence query filters by language', () => {
    const fnStart = src.indexOf('function getEntityDivergence');
    assert.ok(fnStart !== -1, 'getEntityDivergence must exist');
    const fnSlice = src.slice(fnStart, fnStart + 1500);

    assert.ok(fnSlice.includes('language'), 'getEntityDivergence query must reference language column');
  });

  it('getEntityDivergence references both eng and ind languages', () => {
    const fnStart = src.indexOf('function getEntityDivergence');
    assert.ok(fnStart !== -1, 'getEntityDivergence must exist');
    const fnSlice = src.slice(fnStart, fnStart + 1500);

    assert.ok(fnSlice.includes("'eng'"), "getEntityDivergence query must reference 'eng' language");
    assert.ok(fnSlice.includes("'ind'"), "getEntityDivergence query must reference 'ind' language");
  });

  it('getTopDivergentEntities query references both eng and ind languages', () => {
    const fnStart = src.indexOf('function getTopDivergentEntities');
    assert.ok(fnStart !== -1, 'getTopDivergentEntities must exist');
    const fnSlice = src.slice(fnStart, fnStart + 1500);

    assert.ok(fnSlice.includes("'eng'"), "getTopDivergentEntities query must reference 'eng' language");
    assert.ok(fnSlice.includes("'ind'"), "getTopDivergentEntities query must reference 'ind' language");
  });

  it('getTopDivergentEntities query orders by divergence DESC', () => {
    const fnStart = src.indexOf('function getTopDivergentEntities');
    assert.ok(fnStart !== -1, 'getTopDivergentEntities must exist');
    const fnSlice = src.slice(fnStart, fnStart + 1500);

    assert.ok(
      fnSlice.includes('ORDER BY divergence DESC') || fnSlice.includes('ORDER BY\n     divergence DESC'),
      'getTopDivergentEntities must order results by divergence DESC',
    );
  });

  it('getTopDivergentEntities query includes a LIMIT', () => {
    const fnStart = src.indexOf('function getTopDivergentEntities');
    assert.ok(fnStart !== -1, 'getTopDivergentEntities must exist');
    const fnSlice = src.slice(fnStart, fnStart + 1500);

    assert.ok(fnSlice.includes('LIMIT'), 'getTopDivergentEntities query must include a LIMIT clause');
  });

  it('getEntityDivergence computes divergence via ABS(eng - ind)', () => {
    const fnStart = src.indexOf('function getEntityDivergence');
    assert.ok(fnStart !== -1, 'getEntityDivergence must exist');
    const fnSlice = src.slice(fnStart, fnStart + 1500);

    assert.ok(fnSlice.includes('ABS('), 'getEntityDivergence must compute divergence using ABS()');
  });

  it('getTopDivergentEntities computes divergence via ABS(eng - ind)', () => {
    const fnStart = src.indexOf('function getTopDivergentEntities');
    assert.ok(fnStart !== -1, 'getTopDivergentEntities must exist');
    const fnSlice = src.slice(fnStart, fnStart + 1500);

    assert.ok(fnSlice.includes('ABS('), 'getTopDivergentEntities must compute divergence using ABS()');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// server.ts — divergence API routes
// ═══════════════════════════════════════════════════════════════════════

describe('Regional Divergence routes (src/server.ts)', () => {
  const src = readSrc('src/server.ts');

  it('imports getEntityDivergence from db/queries', () => {
    assert.ok(
      /import\s*\{[^}]*getEntityDivergence[^}]*\}/.test(src),
      'server.ts must import getEntityDivergence from db/queries',
    );
  });

  it('imports getTopDivergentEntities from db/queries', () => {
    assert.ok(
      /import\s*\{[^}]*getTopDivergentEntities[^}]*\}/.test(src),
      'server.ts must import getTopDivergentEntities from db/queries',
    );
  });

  it('defines GET /api/v1/divergence route', () => {
    assert.ok(
      src.includes("'/api/v1/divergence'") || src.includes('"/api/v1/divergence"'),
      'server.ts must define a /api/v1/divergence route',
    );
  });

  it('defines GET /api/v1/entities/:entityId/divergence route', () => {
    assert.ok(
      src.includes("'/api/v1/entities/:entityId/divergence'") ||
        src.includes('"/api/v1/entities/:entityId/divergence"'),
      'server.ts must define a /api/v1/entities/:entityId/divergence route',
    );
  });

  it('/api/v1/divergence route uses authPreHandler', () => {
    // Find the route definition and verify authPreHandler is in its options
    const routeIdx = src.indexOf("'/api/v1/divergence'");
    assert.ok(routeIdx !== -1, '/api/v1/divergence route must exist');

    // Look backwards to find the app.get call, then forward for preHandler
    const lineStart = src.lastIndexOf('\n', routeIdx);
    const routeBlock = src.slice(lineStart, routeIdx + 500);

    assert.ok(routeBlock.includes('authPreHandler'), '/api/v1/divergence route must use authPreHandler');
  });

  it('/api/v1/entities/:entityId/divergence route uses authPreHandler', () => {
    const routeIdx = src.indexOf("'/api/v1/entities/:entityId/divergence'");
    assert.ok(routeIdx !== -1, '/api/v1/entities/:entityId/divergence route must exist');

    const lineStart = src.lastIndexOf('\n', routeIdx);
    const routeBlock = src.slice(lineStart, routeIdx + 500);

    assert.ok(
      routeBlock.includes('authPreHandler'),
      '/api/v1/entities/:entityId/divergence route must use authPreHandler',
    );
  });

  it('/api/v1/divergence response includes divergences field', () => {
    const routeIdx = src.indexOf("'/api/v1/divergence'");
    assert.ok(routeIdx !== -1, '/api/v1/divergence route must exist');

    // Grab the handler body (up to 800 chars should cover the route handler)
    const handlerSlice = src.slice(routeIdx, routeIdx + 800);

    assert.ok(handlerSlice.includes('divergences'), '/api/v1/divergence response must include a divergences field');
  });

  it('/api/v1/entities/:entityId/divergence response includes divergence field', () => {
    const routeIdx = src.indexOf("'/api/v1/entities/:entityId/divergence'");
    assert.ok(routeIdx !== -1, '/api/v1/entities/:entityId/divergence route must exist');

    const handlerSlice = src.slice(routeIdx, routeIdx + 800);

    assert.ok(
      handlerSlice.includes('divergence'),
      '/api/v1/entities/:entityId/divergence response must include a divergence field',
    );
  });

  it('/api/v1/divergence calls getTopDivergentEntities', () => {
    const routeIdx = src.indexOf("'/api/v1/divergence'");
    assert.ok(routeIdx !== -1, '/api/v1/divergence route must exist');

    const handlerSlice = src.slice(routeIdx, routeIdx + 800);

    assert.ok(
      handlerSlice.includes('getTopDivergentEntities'),
      '/api/v1/divergence handler must call getTopDivergentEntities',
    );
  });

  it('/api/v1/entities/:entityId/divergence calls getEntityDivergence', () => {
    const routeIdx = src.indexOf("'/api/v1/entities/:entityId/divergence'");
    assert.ok(routeIdx !== -1, '/api/v1/entities/:entityId/divergence route must exist');

    const handlerSlice = src.slice(routeIdx, routeIdx + 800);

    assert.ok(
      handlerSlice.includes('getEntityDivergence'),
      '/api/v1/entities/:entityId/divergence handler must call getEntityDivergence',
    );
  });

  it('/api/v1/divergence supports days query parameter', () => {
    const routeIdx = src.indexOf("'/api/v1/divergence'");
    assert.ok(routeIdx !== -1, '/api/v1/divergence route must exist');

    // Look at the route definition including schema
    const routeSlice = src.slice(Math.max(0, routeIdx - 200), routeIdx + 800);

    assert.ok(routeSlice.includes('days'), '/api/v1/divergence route must accept a days query parameter');
  });

  it('/api/v1/entities/:entityId/divergence supports days query parameter', () => {
    const routeIdx = src.indexOf("'/api/v1/entities/:entityId/divergence'");
    assert.ok(routeIdx !== -1, '/api/v1/entities/:entityId/divergence route must exist');

    const routeSlice = src.slice(Math.max(0, routeIdx - 200), routeIdx + 800);

    assert.ok(
      routeSlice.includes('days'),
      '/api/v1/entities/:entityId/divergence route must accept a days query parameter',
    );
  });

  it('/api/v1/divergence applies toCamelCase serialization', () => {
    const routeIdx = src.indexOf("'/api/v1/divergence'");
    assert.ok(routeIdx !== -1, '/api/v1/divergence route must exist');

    const handlerSlice = src.slice(routeIdx, routeIdx + 800);

    assert.ok(handlerSlice.includes('toCamelCase'), '/api/v1/divergence response must apply toCamelCase serialization');
  });
});
