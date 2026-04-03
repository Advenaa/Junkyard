/**
 * Structural regression tests for cycle 104 fix: AU-031.
 *
 * AU-031: When a blocked user is detected (role === 'blocked'), the middleware
 * must delete the session from DB, clear the cookie, then return 403.
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
// AU-031: Blocked user sessions deleted + cookie cleared
// ===========================================================================

describe('AU-031: blocked user session cleanup in requireAuth middleware', () => {
  const src = readSrc('src/auth/middleware.ts');

  // Extract the blocked-user handling block for ordering assertions
  const blockedBlockStart = src.indexOf("role === 'blocked'");
  const blockedBlock = blockedBlockStart !== -1
    ? src.slice(blockedBlockStart, src.indexOf('}', src.indexOf('return;', blockedBlockStart)) + 1)
    : '';

  it('detects role === blocked and has a handling block', () => {
    assert.ok(blockedBlockStart !== -1, "middleware must check for role === 'blocked'");
    assert.ok(blockedBlock.length > 0, 'blocked handling block must exist');
  });

  it('calls sessionManager.delete(sessionId.value) in the blocked block', () => {
    assert.ok(
      blockedBlock.includes('sessionManager.delete(sessionId.value)'),
      'blocked block must call sessionManager.delete(sessionId.value) to remove session from DB',
    );
  });

  it('calls reply.clearCookie to clear the session cookie', () => {
    assert.ok(
      blockedBlock.includes("reply.clearCookie('podders_session'") ||
        blockedBlock.includes('reply.clearCookie("podders_session"'),
      "blocked block must call reply.clearCookie('podders_session') to clear the cookie",
    );
  });

  it('clearCookie includes path: "/" option', () => {
    assert.match(
      blockedBlock,
      /clearCookie\(\s*['"]podders_session['"]\s*,\s*\{[^}]*path\s*:\s*['"]\/['"]/,
      "clearCookie must include { path: '/' } option",
    );
  });

  it('returns 403 with error message', () => {
    assert.ok(
      blockedBlock.includes('.status(403)') || blockedBlock.includes('.code(403)'),
      'blocked block must return a 403 status',
    );
    assert.ok(
      blockedBlock.includes("'Access blocked'") || blockedBlock.includes('"Access blocked"'),
      "blocked block must return 'Access blocked' error message",
    );
  });

  it('deletes session before clearing cookie and returning 403', () => {
    const deletePos = blockedBlock.indexOf('sessionManager.delete');
    const clearCookiePos = blockedBlock.indexOf('reply.clearCookie');
    const statusPos = blockedBlock.indexOf('.status(403)') !== -1
      ? blockedBlock.indexOf('.status(403)')
      : blockedBlock.indexOf('.code(403)');

    assert.ok(deletePos !== -1, 'sessionManager.delete must be present');
    assert.ok(clearCookiePos !== -1, 'reply.clearCookie must be present');
    assert.ok(statusPos !== -1, '403 response must be present');

    assert.ok(
      deletePos < clearCookiePos,
      'sessionManager.delete must be called before reply.clearCookie',
    );
    assert.ok(
      clearCookiePos < statusPos,
      'reply.clearCookie must be called before the 403 response',
    );
  });

  it('session delete is awaited', () => {
    assert.match(
      blockedBlock,
      /await\s+sessionManager\.delete/,
      'sessionManager.delete must be awaited to ensure DB cleanup completes',
    );
  });
});
