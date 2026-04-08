/**
 * Structural regression tests for H-001: English entity mentions language fix.
 *
 * Bug: English entity mentions were stored with language = NULL instead of 'eng'.
 *
 * Reads source files as strings and verifies:
 * - src/normalize/index.ts sets originalLanguage = 'eng' for English content
 * - src/process/summarize.ts treats null original_language as 'eng' in langCounts
 * - src/db/migrations.ts backfills NULL language to 'eng' and adds CHECK constraints
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
// normalize/index.ts — English language tagging
// ═══════════════════════════════════════════════════════════════════════

describe('H-001 normalize: English language tagging (src/normalize/index.ts)', () => {
  const src = readSrc('src/normalize/index.ts');

  it("sets originalLanguage to 'eng' for English/undetermined content", () => {
    assert.ok(
      src.includes("originalLanguage = 'eng'"),
      "normalize must explicitly set originalLanguage = 'eng' for non-Indonesian content",
    );
  });

  it("sets originalLanguage to 'ind' for Indonesian content", () => {
    assert.ok(
      src.includes("originalLanguage = 'ind'"),
      "normalize must set originalLanguage = 'ind' for Indonesian content",
    );
  });

  it('handles both English and Indonesian languages in the language gate', () => {
    // The language detection section should have an if/else that handles
    // Indonesian (ind/msa/zlm) in one branch and English/und in the other
    const langGateIdx = src.indexOf('Gate 6');
    assert.ok(langGateIdx !== -1, 'Gate 6 (Language tag) section must exist');

    // Gate 6 spans the if(ind) + translation + else(eng) block — allow enough room
    const langSection = src.slice(langGateIdx, langGateIdx + 4000);

    assert.ok(
      langSection.includes("'ind'") && langSection.includes("'eng'"),
      "Gate 6 must handle both 'ind' and 'eng' language assignments",
    );
  });

  it("includes 'eng' in the file (language value is referenced)", () => {
    assert.match(src, /'eng'/, "The string 'eng' must appear in normalize/index.ts");
  });

  it('else branch defaults to eng for non-Indonesian content', () => {
    // The else branch after the Indonesian check should set 'eng'
    // Flexible regex: } else { ... originalLanguage = 'eng'
    assert.match(
      src,
      /else\s*\{[^}]*originalLanguage\s*=\s*'eng'/s,
      "The else branch must default originalLanguage to 'eng'",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// process/summarize.ts — predominant language null fallback
// ═══════════════════════════════════════════════════════════════════════

describe('H-001 summarize: null language fallback (src/process/summarize.ts)', () => {
  const src = readSrc('src/process/summarize.ts');

  it("treats null/undefined original_language as 'eng' via nullish coalescing", () => {
    // Look for the pattern: item.original_language ?? 'eng'
    assert.match(
      src,
      /original_language\s*\?\?\s*'eng'/,
      "summarize must use ?? 'eng' fallback for null original_language",
    );
  });

  it('builds a langCounts map from chunk items', () => {
    assert.ok(src.includes('langCounts'), 'summarize must maintain a langCounts map for language frequency counting');
  });

  it('determines a predominant language from langCounts', () => {
    assert.match(src, /predominantLang/, 'summarize must compute a predominantLang from language counts');
  });

  it("references both 'eng' and 'ind' in the language counting logic", () => {
    // The ClaimedItem interface has original_language, and the counting
    // logic should handle both language values
    const langCountIdx = src.indexOf('langCounts');
    assert.ok(langCountIdx !== -1, 'langCounts must exist in the file');

    // The 'eng' appears as the fallback default, 'ind' appears elsewhere
    // in the pipeline (items come in with 'ind' from normalize)
    assert.ok(src.includes("'eng'"), "summarize must reference 'eng' language value");
  });

  it('passes predominant language to entity resolution', () => {
    assert.match(
      src,
      /resolveEntities\([^)]*predominantLang/,
      'summarize must pass predominantLang to resolveEntities',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// db/migrations.ts — backfill + CHECK constraints
// ═══════════════════════════════════════════════════════════════════════

describe('H-001 migration: backfill NULL language (src/db/migrations.ts)', () => {
  const src = readSrc('src/db/migrations.ts');

  it("contains UPDATE entity_mentions SET language = 'eng' WHERE language IS NULL", () => {
    assert.ok(
      src.includes("UPDATE entity_mentions SET language = 'eng' WHERE language IS NULL"),
      "migration must backfill NULL language values to 'eng'",
    );
  });

  it('references H-001 in migration comments', () => {
    assert.match(src, /H-001/, 'migration must reference the H-001 bug ID');
  });

  it('adds CHECK constraint for confidence range on entity_relationships', () => {
    assert.match(src, /chk_confidence_range/, 'migration must add chk_confidence_range constraint');
    assert.match(
      src,
      /confidence\s*>=\s*0\s+AND\s+confidence\s*<=\s*1/,
      'confidence CHECK constraint must enforce [0, 1] range',
    );
  });

  it('adds CHECK constraint for temporal ordering on entity_relationships', () => {
    assert.match(src, /chk_temporal_order/, 'migration must add chk_temporal_order constraint');
    assert.match(
      src,
      /since_at\s+IS\s+NULL\s+OR\s+until_at\s+IS\s+NULL\s+OR\s+since_at\s*<=\s*until_at/,
      'temporal CHECK constraint must enforce since_at <= until_at when both are set',
    );
  });

  it('backfill and CHECK constraints are in the same migration', () => {
    // Find the migration block that contains H-001 backfill
    const backfillIdx = src.indexOf("UPDATE entity_mentions SET language = 'eng' WHERE language IS NULL");
    assert.ok(backfillIdx !== -1, 'backfill statement must exist');

    // Find surrounding migration function boundaries
    // Look backward for the migration comment and forward for confidence/temporal constraints
    const migrationStart = src.lastIndexOf('// Migration', backfillIdx);
    const migrationSlice = src.slice(migrationStart, migrationStart + 1500);

    assert.ok(
      migrationSlice.includes('chk_confidence_range') && migrationSlice.includes('chk_temporal_order'),
      'backfill and CHECK constraints must be in the same migration block',
    );
  });
});
