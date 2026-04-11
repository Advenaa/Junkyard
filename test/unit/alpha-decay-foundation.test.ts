/**
 * Structural regression tests for Alpha Decay 3.6 — Foundation (Cycle 276).
 *
 * Verifies:
 * - Migration 28 creates alpha_propagation table + source tier column
 * - SourceRow includes tier field
 * - Alpha propagation queries exist with correct signatures
 * - Server has tier update support in source PATCH endpoint
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readServerSource } from './helpers/server-source.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

// ═══════════════════════════════════════════════════════════════════════
// Migration 28
// ═══════════════════════════════════════════════════════════════════════

describe('Migration 28: source tiers + alpha propagation', () => {
  const migrations = readSrc('src/db/migrations.ts');

  it('adds tier column to sources table', () => {
    assert.match(migrations, /ALTER TABLE sources ADD COLUMN.*tier/i);
  });

  it('creates alpha_propagation table', () => {
    assert.match(migrations, /CREATE TABLE.*alpha_propagation/i);
  });

  it('alpha_propagation has entity_id FK', () => {
    assert.match(migrations, /entity_id TEXT NOT NULL REFERENCES entities/);
  });

  it('alpha_propagation has tier column', () => {
    assert.match(migrations, /alpha_propagation[\s\S]*tier TEXT NOT NULL/);
  });

  it('alpha_propagation has first_mention_time BIGINT', () => {
    assert.match(migrations, /first_mention_time BIGINT NOT NULL/);
  });

  it('has index on alpha_propagation entity_id', () => {
    assert.match(migrations, /idx_alpha_propagation_entity/);
  });

  it('tier CHECK constraint includes alpha, influencer, general, mainstream', () => {
    assert.match(migrations, /alpha.*influencer.*general.*mainstream|tier IN/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Queries: SourceRow + alpha propagation
// ═══════════════════════════════════════════════════════════════════════

describe('SourceRow includes tier', () => {
  const queries = readSrc('src/db/queries.ts');

  it('SourceRow interface has tier field', () => {
    // SourceRow should contain tier: string
    assert.match(queries, /interface SourceRow[\s\S]*?tier\s*:\s*string/);
  });
});

describe('Alpha propagation queries', () => {
  const queries = readSrc('src/db/queries.ts');

  it('exports AlphaPropagationRow interface', () => {
    assert.match(queries, /export\s+interface\s+AlphaPropagationRow/);
  });

  it('exports insertAlphaPropagation function', () => {
    assert.match(queries, /export\s+async\s+function\s+insertAlphaPropagation/);
  });

  it('exports getAlphaPropagationByEntity function', () => {
    assert.match(queries, /export\s+async\s+function\s+getAlphaPropagationByEntity/);
  });

  it('exports getAlphaPropagationByEvent function', () => {
    assert.match(queries, /export\s+async\s+function\s+getAlphaPropagationByEvent/);
  });

  it('exports getAlphaPropagationSummary function', () => {
    assert.match(queries, /export\s+async\s+function\s+getAlphaPropagationSummary/);
  });

  it('exports updateSourceTier function', () => {
    assert.match(queries, /export\s+async\s+function\s+updateSourceTier/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Server: tier in source PATCH
// ═══════════════════════════════════════════════════════════════════════

describe('Server: source tier API', () => {
  const server = readServerSource();

  it('imports updateSourceTier', () => {
    assert.ok(server.includes('updateSourceTier'));
  });

  it('PATCH source endpoint accepts tier', () => {
    assert.match(server, /tier.*enum.*alpha.*influencer|alpha.*influencer.*general.*mainstream/);
  });
});
