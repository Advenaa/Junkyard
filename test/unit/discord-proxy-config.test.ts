import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createEnvDiscordTokens, maskProxyUrl, normalizeProxyUrl } from '../../src/discord-tokens.js';
import { readServerSource } from './helpers/server-source.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const migrationsSrc = readFileSync(resolve(ROOT, 'src/db/migrations.ts'), 'utf-8');
const queriesSrc = readFileSync(resolve(ROOT, 'src/db/queries.ts'), 'utf-8');
const serverSrc = readServerSource();

describe('Discord proxy config helpers', () => {
  it('normalizes http proxy URLs with credentials', () => {
    assert.equal(
      normalizeProxyUrl('  http://user:pass@proxy.example.com:8080  '),
      'http://user:pass@proxy.example.com:8080/',
    );
  });

  it('accepts https proxy URLs without credentials', () => {
    assert.equal(normalizeProxyUrl('https://proxy.example.com:8443'), 'https://proxy.example.com:8443/');
  });

  it('rejects proxy URLs with paths, queries, or hashes', () => {
    assert.throws(() => normalizeProxyUrl('http://proxy.example.com:8080/path'), /must not include a path/i);
    assert.throws(() => normalizeProxyUrl('http://proxy.example.com:8080/?foo=bar'), /must not include a path/i);
    assert.throws(() => normalizeProxyUrl('http://proxy.example.com:8080/#frag'), /must not include a path/i);
  });

  it('rejects non-http proxy protocols', () => {
    assert.throws(() => normalizeProxyUrl('socks5://proxy.example.com:1080'), /must use http:\/\/ or https:\/\//i);
  });

  it('masks proxy credentials before display', () => {
    assert.equal(maskProxyUrl('http://user:pass@proxy.example.com:8080/'), 'http://proxy.example.com:8080');
  });

  it('deduplicates env tokens while preserving first-match metadata', () => {
    const tokens = createEnvDiscordTokens(['tok-A', 'tok-A', 'tok-B']);
    assert.deepEqual(
      tokens.map((token) => ({
        token: token.token,
        source: token.source,
        proxyUrl: token.proxyUrl,
      })),
      [
        { token: 'tok-A', source: 'env', proxyUrl: null },
        { token: 'tok-B', source: 'env', proxyUrl: null },
      ],
    );
  });
});

describe('Discord proxy persistence wiring', () => {
  it('adds encrypted proxy columns to discord_tokens', () => {
    assert.ok(migrationsSrc.includes('proxy_url_encrypted TEXT'));
    assert.ok(migrationsSrc.includes('proxy_url_iv TEXT'));
    assert.ok(migrationsSrc.includes('proxy_url_auth_tag TEXT'));
  });

  it('exposes a query helper for proxy updates', () => {
    assert.ok(queriesSrc.includes('export async function updateDiscordTokenProxy'));
    assert.ok(queriesSrc.includes('SET proxy_url_encrypted = $1'));
  });

  it('accepts proxyUrl in token create and patch routes', () => {
    assert.ok(serverSrc.includes("proxyUrl: { type: 'string'"));
    assert.ok(serverSrc.includes("Object.prototype.hasOwnProperty.call(body, 'proxyUrl')"));
  });
});
