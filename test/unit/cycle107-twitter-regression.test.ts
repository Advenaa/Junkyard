/**
 * Structural regression tests for cycle 107: TW-001 and TW-006
 *
 * TW-001: Circuit breaker for Twitter consecutive failures
 * TW-006: Expanded zod schema fields in TwitterTweetSchema
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
// TW-001: Circuit breaker for Twitter consecutive failures
// ===========================================================================

describe('TW-001: Circuit breaker for Twitter', () => {
  const src = readSrc('src/ingest/twitter.ts');

  it('CONSECUTIVE_FAILURE_THRESHOLD is defined as 10', () => {
    assert.match(
      src,
      /const CONSECUTIVE_FAILURE_THRESHOLD\s*=\s*10/,
      'CONSECUTIVE_FAILURE_THRESHOLD must be defined as 10',
    );
  });

  it('consecutiveFailures is a Map', () => {
    assert.match(
      src,
      /const consecutiveFailures\s*=\s*new Map<string,\s*number>\(\)/,
      'consecutiveFailures must be a Map<string, number>',
    );
  });

  it('poll loop increments consecutive failures on null fetchPage result', () => {
    assert.match(
      src,
      /const failures\s*=\s*\(consecutiveFailures\.get\(sourceId\)\s*\?\?\s*0\)\s*\+\s*1/,
      'Must increment failure counter when fetchPage returns null',
    );
    assert.match(
      src,
      /consecutiveFailures\.set\(sourceId,\s*failures\)/,
      'Must store incremented failure count in consecutiveFailures map',
    );
  });

  it('throws Error with "circuit breaker" message when threshold reached', () => {
    assert.match(
      src,
      /if\s*\(failures\s*>=\s*CONSECUTIVE_FAILURE_THRESHOLD\)/,
      'Must check failures against CONSECUTIVE_FAILURE_THRESHOLD',
    );
    assert.match(
      src,
      /throw new Error\(\s*[`'"]Twitter circuit breaker/,
      'Must throw Error with "circuit breaker" in the message',
    );
  });

  it('resets consecutive failures on successful pagination', () => {
    assert.match(
      src,
      /consecutiveFailures\.delete\(sourceId\)/,
      'Must reset (delete) consecutiveFailures for sourceId on success',
    );
  });
});

// ===========================================================================
// TW-006: Expanded zod schema fields
// ===========================================================================

describe('TW-006: Expanded zod schema fields in TwitterTweetSchema', () => {
  const src = readSrc('src/ingest/twitter.ts');

  it('TwitterTweetSchema includes viewCount with default 0', () => {
    assert.match(
      src,
      /viewCount:\s*z\.number\(\)\.default\(0\)/,
      'TwitterTweetSchema must include viewCount: z.number().default(0)',
    );
  });

  it('TwitterTweetSchema includes bookmarkCount with default 0', () => {
    assert.match(
      src,
      /bookmarkCount:\s*z\.number\(\)\.default\(0\)/,
      'TwitterTweetSchema must include bookmarkCount: z.number().default(0)',
    );
  });

  it('TwitterTweetSchema includes lang as optional string', () => {
    assert.match(
      src,
      /lang:\s*z\.string\(\)\.optional\(\)/,
      'TwitterTweetSchema must include lang: z.string().optional()',
    );
  });

  it('TwitterTweetSchema includes isReply as optional boolean', () => {
    assert.match(
      src,
      /isReply:\s*z\.boolean\(\)\.optional\(\)/,
      'TwitterTweetSchema must include isReply: z.boolean().optional()',
    );
  });

  it('TwitterTweetSchema includes inReplyToId as nullable optional string', () => {
    assert.match(
      src,
      /inReplyToId:\s*z\.string\(\)\.nullable\(\)\.optional\(\)/,
      'TwitterTweetSchema must include inReplyToId: z.string().nullable().optional()',
    );
  });

  it('TwitterTweetSchema includes conversationId as optional string', () => {
    assert.match(
      src,
      /conversationId:\s*z\.string\(\)\.optional\(\)/,
      'TwitterTweetSchema must include conversationId: z.string().optional()',
    );
  });

  it('author schema includes id as optional string', () => {
    // Match within the author object definition
    assert.ok(src.includes('id: z.string().optional()'), 'Author schema must include id: z.string().optional()');
  });

  it('author schema includes isBlueVerified as optional boolean', () => {
    assert.match(
      src,
      /isBlueVerified:\s*z\.boolean\(\)\.optional\(\)/,
      'Author schema must include isBlueVerified: z.boolean().optional()',
    );
  });
});

describe('TW-006: tweetToRawItem metadata includes expanded fields', () => {
  const src = readSrc('src/ingest/twitter.ts');

  it('metadata includes views field', () => {
    assert.match(src, /views:\s*tweet\.viewCount/, 'metadata must include views: tweet.viewCount');
  });

  it('metadata includes bookmarks field', () => {
    assert.match(src, /bookmarks:\s*tweet\.bookmarkCount/, 'metadata must include bookmarks: tweet.bookmarkCount');
  });

  it('metadata includes lang field', () => {
    assert.match(src, /lang:\s*tweet\.lang/, 'metadata must include lang: tweet.lang');
  });

  it('metadata includes isReply field', () => {
    assert.match(src, /isReply:\s*tweet\.isReply/, 'metadata must include isReply: tweet.isReply');
  });

  it('metadata includes isVerified field from author', () => {
    assert.match(
      src,
      /isVerified:\s*tweet\.author\.isBlueVerified/,
      'metadata must include isVerified: tweet.author.isBlueVerified',
    );
  });

  it('metadata includes followers field from author', () => {
    assert.match(
      src,
      /followers:\s*tweet\.author\.followers/,
      'metadata must include followers: tweet.author.followers',
    );
  });

  it('metadata includes authorId field from author', () => {
    assert.match(src, /authorId:\s*tweet\.author\.id/, 'metadata must include authorId: tweet.author.id');
  });
});
