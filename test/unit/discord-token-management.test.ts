/**
 * Structural + behavioral tests for the Discord token management feature.
 *
 * Section 1: Reads source files as strings and verifies encryption module,
 * migration schema, query exports, and server route patterns.
 *
 * Section 2: Imports actual encryption functions and tests roundtrip
 * encrypt/decrypt, IV uniqueness, and missing-key behavior.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encryptToken, decryptToken, getEncryptionKey } from '../../src/crypto/token-encrypt.js';
import { readServerSource } from './helpers/server-source.js';

const ROOT = resolve(import.meta.dirname, '..', '..');

const encryptSrc = readFileSync(resolve(ROOT, 'src/crypto/token-encrypt.ts'), 'utf-8');
const migrationsSrc = readFileSync(resolve(ROOT, 'src/db/migrations.ts'), 'utf-8');
const queriesSrc = readFileSync(resolve(ROOT, 'src/db/queries.ts'), 'utf-8');
const serverSrc = readServerSource();

// ==========================================================================
// Section 1: Structural tests (source file verification)
// ==========================================================================

describe('Structural: encryption module (src/crypto/token-encrypt.ts)', () => {
  it('1. exports encryptToken function', () => {
    assert.ok(encryptSrc.includes('export function encryptToken'), 'must export encryptToken function');
  });

  it('2. exports decryptToken function', () => {
    assert.ok(encryptSrc.includes('export function decryptToken'), 'must export decryptToken function');
  });

  it('3. exports getEncryptionKey function', () => {
    assert.ok(encryptSrc.includes('export function getEncryptionKey'), 'must export getEncryptionKey function');
  });

  it('4. uses aes-256-gcm algorithm', () => {
    assert.ok(encryptSrc.includes('aes-256-gcm'), 'must use aes-256-gcm algorithm');
  });

  it('5. uses pbkdf2Sync for key derivation', () => {
    assert.ok(encryptSrc.includes('pbkdf2Sync'), 'must use pbkdf2Sync for key derivation');
  });
});

describe('Structural: migration (src/db/migrations.ts)', () => {
  it('6. contains discord_tokens table creation', () => {
    assert.ok(migrationsSrc.includes('CREATE TABLE discord_tokens'), 'migration must create discord_tokens table');
  });

  it('7. table has encrypted_token, iv, auth_tag columns', () => {
    assert.ok(migrationsSrc.includes('encrypted_token'), 'discord_tokens must have encrypted_token column');
    assert.ok(migrationsSrc.includes('iv TEXT NOT NULL'), 'discord_tokens must have iv column');
    assert.ok(migrationsSrc.includes('auth_tag TEXT NOT NULL'), 'discord_tokens must have auth_tag column');
  });

  it('8. has CHECK constraint on status (active, disabled)', () => {
    // Find the discord_tokens table block and check for the constraint
    const tableIdx = migrationsSrc.indexOf('CREATE TABLE discord_tokens');
    assert.ok(tableIdx !== -1);
    const tableBlock = migrationsSrc.slice(tableIdx, tableIdx + 500);
    assert.ok(
      tableBlock.includes('CHECK') && tableBlock.includes("'active'") && tableBlock.includes("'disabled'"),
      'discord_tokens must have CHECK constraint with active and disabled statuses',
    );
  });
});

describe('Structural: queries (src/db/queries.ts)', () => {
  it('9. exports getDiscordTokens function', () => {
    assert.ok(queriesSrc.includes('export async function getDiscordTokens'), 'must export getDiscordTokens function');
  });

  it('10. exports insertDiscordToken function', () => {
    assert.ok(
      queriesSrc.includes('export async function insertDiscordToken'),
      'must export insertDiscordToken function',
    );
  });

  it('11. exports deleteDiscordToken function', () => {
    assert.ok(
      queriesSrc.includes('export async function deleteDiscordToken'),
      'must export deleteDiscordToken function',
    );
  });
});

describe('Structural: server routes (src/server.ts)', () => {
  it('12. has GET /api/v1/discord/tokens route', () => {
    assert.ok(
      serverSrc.includes("'/api/v1/discord/tokens'") && serverSrc.includes('.get('),
      'must have GET /api/v1/discord/tokens route',
    );
  });

  it('13. has POST /api/v1/discord/tokens route', () => {
    assert.ok(
      serverSrc.includes("'/api/v1/discord/tokens'") && serverSrc.includes('.post('),
      'must have POST /api/v1/discord/tokens route',
    );
  });

  it('14. has DELETE /api/v1/discord/tokens/:tokenId route', () => {
    assert.ok(
      serverSrc.includes("'/api/v1/discord/tokens/:tokenId'") && serverSrc.includes('.delete'),
      'must have DELETE /api/v1/discord/tokens/:tokenId route',
    );
  });

  it('15. has PATCH /api/v1/discord/tokens/:tokenId route', () => {
    assert.ok(
      serverSrc.includes("'/api/v1/discord/tokens/:tokenId'") && serverSrc.includes('.patch'),
      'must have PATCH /api/v1/discord/tokens/:tokenId route',
    );
  });

  it('16. token routes require admin auth', () => {
    // All four token route registrations should include requireAdmin in their preHandler
    // Find the discord token management section
    const sectionStart = serverSrc.indexOf('Discord token management');
    assert.ok(sectionStart !== -1, 'must have Discord token management section comment');
    const tokenSection = serverSrc.slice(sectionStart);

    // Each CRUD route in the token section should reference requireAdmin
    const getRoute = tokenSection.slice(0, tokenSection.indexOf('app.post'));
    assert.ok(getRoute.includes('requireAdmin'), 'GET tokens route must require admin auth');

    const postRoute = tokenSection.slice(tokenSection.indexOf('app.post'), tokenSection.indexOf('app.delete'));
    assert.ok(postRoute.includes('requireAdmin'), 'POST tokens route must require admin auth');

    const deleteRoute = tokenSection.slice(tokenSection.indexOf('app.delete'), tokenSection.indexOf('app.patch'));
    assert.ok(deleteRoute.includes('requireAdmin'), 'DELETE tokens route must require admin auth');

    const patchRoute = tokenSection.slice(tokenSection.indexOf('app.patch'));
    assert.ok(patchRoute.includes('requireAdmin'), 'PATCH tokens route must require admin auth');
  });

  it('17. GET endpoint masks tokens (contains .slice(0, 10))', () => {
    // Find the GET handler body for discord tokens
    const getIdx = serverSrc.indexOf("'/api/v1/discord/tokens'");
    assert.ok(getIdx !== -1);
    const getBody = serverSrc.slice(getIdx, getIdx + 800);
    assert.ok(
      getBody.includes('maskedToken') || getBody.includes('maskDiscordToken'),
      'GET tokens endpoint must expose masked tokens',
    );
  });
});

// ==========================================================================
// Section 2: Behavioral tests (encryption roundtrip)
// ==========================================================================

describe('Behavioral: encryption roundtrip', () => {
  const TEST_PASSPHRASE = 'test-passphrase-for-unit-tests-32bytes!!';

  it('18. encryptToken returns object with ciphertext, iv, authTag fields', () => {
    const result = encryptToken('some-discord-token', TEST_PASSPHRASE);
    assert.ok('ciphertext' in result, 'must have ciphertext field');
    assert.ok('iv' in result, 'must have iv field');
    assert.ok('authTag' in result, 'must have authTag field');
    assert.ok(typeof result.ciphertext === 'string' && result.ciphertext.length > 0);
    assert.ok(typeof result.iv === 'string' && result.iv.length > 0);
    assert.ok(typeof result.authTag === 'string' && result.authTag.length > 0);
  });

  it('19. decryptToken recovers original plaintext from encrypted output', () => {
    const plaintext = 'MTIzNDU2Nzg5MDEyMzQ1Njc4.ABCDEF.some-discord-token-value';
    const encrypted = encryptToken(plaintext, TEST_PASSPHRASE);
    const recovered = decryptToken(encrypted, TEST_PASSPHRASE);
    assert.equal(recovered, plaintext);
  });

  it('20. decrypting with wrong key throws an error', () => {
    const encrypted = encryptToken('secret-token', TEST_PASSPHRASE);
    assert.throws(
      () => decryptToken(encrypted, 'wrong-passphrase-completely-different'),
      'decrypting with wrong key must throw',
    );
  });

  it('21. each encryption produces different IV (encrypt same token twice, IVs differ)', () => {
    const token = 'same-token-encrypted-twice';
    const first = encryptToken(token, TEST_PASSPHRASE);
    const second = encryptToken(token, TEST_PASSPHRASE);
    assert.notEqual(first.iv, second.iv, 'IVs must differ between encryptions');
  });

  it('22. getEncryptionKey returns null when env vars not set', () => {
    // Save current values
    const savedTokenKey = process.env['TOKEN_ENCRYPTION_KEY'];
    const savedSessionSecret = process.env['SESSION_SECRET'];

    try {
      // Clear both env vars
      delete process.env['TOKEN_ENCRYPTION_KEY'];
      delete process.env['SESSION_SECRET'];

      const result = getEncryptionKey();
      assert.equal(result, null, 'must return null when neither env var is set');
    } finally {
      // Restore original values
      if (savedTokenKey !== undefined) {
        process.env['TOKEN_ENCRYPTION_KEY'] = savedTokenKey;
      } else {
        delete process.env['TOKEN_ENCRYPTION_KEY'];
      }
      if (savedSessionSecret !== undefined) {
        process.env['SESSION_SECRET'] = savedSessionSecret;
      } else {
        delete process.env['SESSION_SECRET'];
      }
    }
  });
});

// ==========================================================================
// Section 3: Structural tests — Discord REST wiring
// ==========================================================================

/** Read a source file relative to the project root. */
function readSrc(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), 'utf-8');
}

describe('Discord REST updateTokens (discord-rest.ts)', () => {
  const src = readSrc('src/ingest/discord-rest.ts');

  it('exports updateTokens method', () => {
    assert.ok(src.includes('updateTokens'), 'REST adapter must include updateTokens method');
  });

  it('uses mutable activeTokens variable', () => {
    assert.ok(src.includes('activeTokens'), 'Must use mutable activeTokens for hot-reload');
  });
});

describe('Token integration wiring (server.ts)', () => {
  const src = readServerSource();

  it('createServer accepts onTokensChanged parameter', () => {
    assert.ok(src.includes('onTokensChanged'), 'server must accept onTokensChanged callback');
  });

  it('createServer accepts getTokenHealth parameter', () => {
    assert.ok(src.includes('getTokenHealth'), 'server must accept getTokenHealth callback');
  });

  it('POST /discord/tokens triggers onTokensChanged', () => {
    // Find the await insertDiscordToken call (not the import)
    const postIdx = src.indexOf('await insertDiscordToken(');
    assert.ok(postIdx !== -1, 'await insertDiscordToken call must exist');
    const block = src.slice(postIdx, postIdx + 300);
    assert.ok(block.includes('onTokensChanged'), 'POST token must trigger onTokensChanged after insert');
  });

  it('DELETE /discord/tokens triggers onTokensChanged', () => {
    // Find the await deleteDiscordToken call (not the import)
    const deleteIdx = src.indexOf('await deleteDiscordToken(');
    assert.ok(deleteIdx !== -1, 'await deleteDiscordToken call must exist');
    const block = src.slice(deleteIdx, deleteIdx + 300);
    assert.ok(block.includes('onTokensChanged'), 'DELETE token must trigger onTokensChanged after delete');
  });

  it('has GET /discord/tokens/health endpoint', () => {
    assert.ok(src.includes('/api/v1/discord/tokens/health'), 'health endpoint must exist');
  });

  it('discordRest.updateTokens called on token change', () => {
    assert.ok(src.includes('discordRest.updateTokens'), 'must update REST adapter tokens');
  });
});

describe('Token loading in index.ts', () => {
  const src = readSrc('src/index.ts');

  it('imports getDiscordTokens from queries', () => {
    assert.ok(src.includes('getDiscordTokens'), 'must import getDiscordTokens');
  });

  it('imports decryptToken from crypto', () => {
    assert.ok(src.includes('decryptToken'), 'must import decryptToken');
  });

  it('defines loadAllTokens helper', () => {
    assert.ok(src.includes('loadAllTokens'), 'must define loadAllTokens function');
  });

  it('passes onTokensChanged to createServer', () => {
    const serverCall = src.match(/createServer\([\s\S]*?onTokensChanged/);
    assert.ok(serverCall, 'createServer call must include onTokensChanged');
  });

  it('passes getTokenHealth to createServer', () => {
    const serverCall = src.match(/createServer\([\s\S]*?getTokenHealth/);
    assert.ok(serverCall, 'createServer call must include getTokenHealth');
  });
});
