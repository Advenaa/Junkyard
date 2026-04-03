/**
 * Structural regression tests for cycle 87-88 entity lifecycle fixes.
 *
 * EL-015: Tier 1 reactivates archived entities on alias match
 * EL-010: Tier 2 co-occurrence is type-aware (composite key with \0 separator)
 * EL-011: CoinGecko symbol aliases use context_key for non-top-100
 * EL-016: dateToEpochMsBounds uses target date not now
 * EL-014: entity_sentiment_daily pruned at 365 days in retention
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

// ===========================================================================
// EL-015: Tier 1 reactivates archived entities on alias match
// ===========================================================================

describe('EL-015: Tier 1 alias lookup selects status and reactivates archived entities', () => {
  const src = readSrc('src/knowledge/entities.ts');

  it('Tier 1 SELECT includes e.status from the entities table', () => {
    // The alias query must JOIN entities and select status
    assert.match(
      src,
      /SELECT\s+ea\.entity_id\s*,\s*e\.status\s+FROM\s+entity_aliases\s+ea/i,
      'Tier 1 alias query must SELECT e.status alongside ea.entity_id',
    );
  });

  it('Tier 1 JOINs entities table to access status', () => {
    assert.match(
      src,
      /JOIN\s+entities\s+e\s+ON\s+e\.id\s*=\s*ea\.entity_id/i,
      'Tier 1 alias query must JOIN entities to get status',
    );
  });

  it('checks if matched entity status is archived', () => {
    assert.match(
      src,
      /row\.status\s*===\s*'archived'/,
      'Tier 1 must check if the matched entity is archived',
    );
  });

  it('UPDATEs archived entity to active with relevance 0.5', () => {
    assert.match(
      src,
      /UPDATE\s+entities\s+SET\s+status\s*=\s*'active'\s*,\s*relevance\s*=\s*0\.5/i,
      'Tier 1 must UPDATE archived entities to active with relevance = 0.5',
    );
  });

  it('reactivation UPDATE is inside the archived status check block', () => {
    // Find the archived check and verify the UPDATE follows it within the same block
    const archivedIdx = src.indexOf("row.status === 'archived'");
    assert.ok(archivedIdx !== -1, 'archived status check must exist');

    const updateIdx = src.indexOf("UPDATE entities SET status = 'active'", archivedIdx);
    assert.ok(updateIdx !== -1, 'UPDATE to active must appear after archived check');

    // The UPDATE should be close to the check (within ~300 chars), not in a different section
    assert.ok(
      updateIdx - archivedIdx < 300,
      'UPDATE to reactivate must be within the archived check block, not in a distant section',
    );
  });

  it('logs reactivation event', () => {
    assert.match(
      src,
      /reactivated\s+archived\s+entity\s+via\s+alias\s+match/,
      'Must log reactivation for observability',
    );
  });
});

// ===========================================================================
// EL-010: Tier 2 co-occurrence is type-aware
// ===========================================================================

describe('EL-010: Tier 2 co-occurrence query is type-aware with composite key', () => {
  const src = readSrc('src/knowledge/entities.ts');

  it('co-occurrence query JOINs entities table for type', () => {
    // Find the Tier 2 co-occurrence query and verify it joins entities
    const coOccurQueryStart = src.indexOf('coOccurring');
    assert.ok(coOccurQueryStart !== -1, 'coOccurring query variable must exist');

    const queryBlock = src.slice(coOccurQueryStart, coOccurQueryStart + 500);
    assert.match(
      queryBlock,
      /JOIN\s+entities\s+e\s+ON\s+e\.id\s*=\s*ea\.entity_id/i,
      'Tier 2 co-occurrence query must JOIN entities to access type',
    );
  });

  it('co-occurrence query SELECTs e.type', () => {
    const coOccurQueryStart = src.indexOf('coOccurring');
    const queryBlock = src.slice(coOccurQueryStart, coOccurQueryStart + 500);
    assert.match(
      queryBlock,
      /SELECT\s+DISTINCT\s+ea\.alias\s*,\s*ea\.entity_id\s*,\s*e\.type/i,
      'Tier 2 co-occurrence query must SELECT e.type',
    );
  });

  it('coOccurMap uses null byte separator for composite key', () => {
    // The map key must use \0 to combine alias + type
    assert.match(
      src,
      /coOccurMap\.set\(`\$\{row\.alias\}\\0\$\{row\.type\}`/,
      'coOccurMap must use \\0 separator in composite key (alias + type)',
    );
  });

  it('coOccurMap lookup uses the same composite key format', () => {
    assert.match(
      src,
      /coOccurMap\.get\(`\$\{canonical\}\\0\$\{entity\.type\}`\)/,
      'coOccurMap.get must use matching composite key format (canonical + \\0 + entity.type)',
    );
  });
});

// ===========================================================================
// EL-011: CoinGecko symbol aliases use context_key for non-top-100
// ===========================================================================

describe('EL-011: CoinGecko seed uses context_key for non-top-100 symbol aliases', () => {
  const src = readSrc('src/knowledge/seed.ts');

  it('symbol alias INSERT includes context_key column', () => {
    // The batch alias INSERT must include context_key
    assert.match(
      src,
      /INSERT\s+INTO\s+entity_aliases\s*\(\s*alias\s*,\s*context_key\s*,\s*entity_id\s*\)/i,
      'entity_aliases INSERT must include context_key column',
    );
  });

  it('differentiates top-100 from others using market_cap_rank', () => {
    assert.match(
      src,
      /market_cap_rank\s*&&\s*.*market_cap_rank\s*<=\s*100/,
      'Must check market_cap_rank <= 100 to differentiate top tokens',
    );
  });

  it('top-100 tokens get empty context_key for their symbol', () => {
    // The ternary should assign '' for top-100
    assert.match(
      src,
      /market_cap_rank\s*<=\s*100\s*\?\s*''/,
      'Top-100 tokens must get empty string context_key',
    );
  });

  it('non-top-100 tokens get a coingecko-prefixed context_key', () => {
    assert.match(
      src,
      /`coingecko:\$\{coin\.id\}`/,
      'Non-top-100 tokens must get context_key like coingecko:<coin_id>',
    );
  });

  it('symbolContextKey variable is used when inserting symbol alias', () => {
    assert.match(
      src,
      /symbolContextKey/,
      'symbolContextKey variable must exist and be used for symbol alias insertion',
    );

    // Verify it appears in the alias values push
    const pushIdx = src.indexOf('aliasValues.push(symbolAlias, symbolContextKey');
    assert.ok(
      pushIdx !== -1,
      'symbolContextKey must be pushed into aliasValues alongside the symbol alias',
    );
  });
});

// ===========================================================================
// EL-016: dateToEpochMsBounds uses target date not new Date()
// ===========================================================================

describe('EL-016: dateToEpochMsBounds computes offset from target date, not now', () => {
  const src = readSrc('src/knowledge/sentiment.ts');

  it('dateToEpochMsBounds function exists', () => {
    assert.match(
      src,
      /function\s+dateToEpochMsBounds\s*\(\s*dateString\s*:\s*string/,
      'dateToEpochMsBounds function must exist with dateString parameter',
    );
  });

  it('creates a reference date from the dateString parameter, not from new Date()', () => {
    // Extract the function body — skip past the return type annotation { ... }
    // by finding the second top-level '{' after the function keyword
    const fnStart = src.indexOf('function dateToEpochMsBounds');
    assert.ok(fnStart !== -1, 'dateToEpochMsBounds must exist');

    // Find the function body: skip the return type { ... } by counting braces
    let braceCount = 0;
    let bodyStart = -1;
    for (let i = src.indexOf('{', fnStart); i < src.length; i++) {
      if (src[i] === '{') braceCount++;
      if (src[i] === '}') braceCount--;
      if (braceCount === 0) {
        // End of the return type annotation — next '{' is the function body
        bodyStart = src.indexOf('{', i + 1);
        break;
      }
    }
    assert.ok(bodyStart > fnStart, 'Could not find function body start');

    let depth = 0;
    let fnEnd = -1;
    for (let i = bodyStart; i < src.length; i++) {
      if (src[i] === '{') depth++;
      if (src[i] === '}') depth--;
      if (depth === 0) { fnEnd = i; break; }
    }
    assert.ok(fnEnd > bodyStart, 'Could not find end of dateToEpochMsBounds');
    const fnBody = src.slice(bodyStart, fnEnd + 1);

    // Must create reference from dateString, not new Date() with no args
    assert.match(
      fnBody,
      /new\s+Date\(\s*dateString\s*\+/,
      'referenceDate must be constructed from dateString (e.g., dateString + "T12:00:00Z"), not new Date()',
    );
  });

  it('does NOT use bare new Date() for timezone offset computation', () => {
    const fnStart = src.indexOf('function dateToEpochMsBounds');
    let braceCount = 0;
    let bodyStart = -1;
    for (let i = src.indexOf('{', fnStart); i < src.length; i++) {
      if (src[i] === '{') braceCount++;
      if (src[i] === '}') braceCount--;
      if (braceCount === 0) {
        bodyStart = src.indexOf('{', i + 1);
        break;
      }
    }
    let depth = 0;
    let fnEnd = -1;
    for (let i = bodyStart; i < src.length; i++) {
      if (src[i] === '{') depth++;
      if (src[i] === '}') depth--;
      if (depth === 0) { fnEnd = i; break; }
    }
    const fnBody = src.slice(bodyStart, fnEnd + 1);

    // new Date() with no arguments would use "now" — must not appear
    assert.doesNotMatch(
      fnBody,
      /new\s+Date\(\s*\)/,
      'dateToEpochMsBounds must NOT use new Date() (no args = current time)',
    );
  });

  it('uses toLocaleString with both UTC and target timezone for offset calculation', () => {
    const fnStart = src.indexOf('function dateToEpochMsBounds');
    let braceCount = 0;
    let bodyStart = -1;
    for (let i = src.indexOf('{', fnStart); i < src.length; i++) {
      if (src[i] === '{') braceCount++;
      if (src[i] === '}') braceCount--;
      if (braceCount === 0) {
        bodyStart = src.indexOf('{', i + 1);
        break;
      }
    }
    let depth = 0;
    let fnEnd = -1;
    for (let i = bodyStart; i < src.length; i++) {
      if (src[i] === '{') depth++;
      if (src[i] === '}') depth--;
      if (depth === 0) { fnEnd = i; break; }
    }
    const fnBody = src.slice(bodyStart, fnEnd + 1);

    assert.match(
      fnBody,
      /toLocaleString\([^)]*'UTC'/,
      'Must compute UTC string via toLocaleString for offset calculation',
    );
    assert.match(
      fnBody,
      /toLocaleString\([^)]*timezone/,
      'Must compute local string via toLocaleString with target timezone',
    );
  });
});

// ===========================================================================
// EL-014: entity_sentiment_daily pruned at 365 days in retention
// ===========================================================================

describe('EL-014: retention prunes entity_sentiment_daily at 365 days', () => {
  const src = readSrc('src/ops/retention.ts');

  it('DELETE FROM entity_sentiment_daily exists in the file', () => {
    assert.match(
      src,
      /DELETE\s+FROM\s+entity_sentiment_daily/i,
      'retention must include DELETE FROM entity_sentiment_daily',
    );
  });

  it('uses 365-day retention period for sentiment data', () => {
    assert.match(
      src,
      /365/,
      'retention must reference 365 days for sentiment daily cleanup',
    );
  });

  it('sentimentDailyDeleted is tracked in the result', () => {
    assert.match(
      src,
      /sentimentDailyDeleted/,
      'retention result must track sentimentDailyDeleted count',
    );
  });

  it('RetentionResult interface includes sentimentDailyDeleted field', () => {
    assert.match(
      src,
      /sentimentDailyDeleted\s*:\s*number/,
      'RetentionResult must declare sentimentDailyDeleted: number',
    );
  });

  it('sentiment deletion uses date column (not epoch) for comparison', () => {
    // entity_sentiment_daily.date is a DATE string, so WHERE should use date < $1
    assert.match(
      src,
      /DELETE\s+FROM\s+entity_sentiment_daily\s+WHERE\s+date\s*<\s*\$1/i,
      'sentiment daily DELETE must compare on date column (not created_at epoch)',
    );
  });

  it('computes cutoff date as ISO string for DATE column comparison', () => {
    // The code should convert epoch to YYYY-MM-DD string via toISOString().slice(0, 10)
    assert.match(
      src,
      /toISOString\(\)\.slice\(0,\s*10\)/,
      'Must convert cutoff to ISO date string for DATE column comparison',
    );
  });
});
