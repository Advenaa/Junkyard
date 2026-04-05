import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

// ==========================================================================
// Discord REST module exists and exports correctly
// ==========================================================================

describe('Discord REST module (discord-rest.ts)', () => {
  const src = readSrc('src/ingest/discord-rest.ts');

  it('exports createDiscordRest factory', () => {
    assert.ok(src.includes('export function createDiscordRest'), 'Must export createDiscordRest');
  });

  it('exports DiscordGuild interface', () => {
    assert.ok(src.includes('export interface DiscordGuild'), 'Must export DiscordGuild interface');
  });

  it('exports DiscordChannel interface', () => {
    assert.ok(src.includes('export interface DiscordChannel'), 'Must export DiscordChannel interface');
  });

  it('uses Discord API v10', () => {
    assert.ok(src.includes('discord.com/api/v10'), 'Must use Discord API v10');
  });

  it('handles 429 rate limiting', () => {
    assert.ok(src.includes('429'), 'Must handle 429 rate limit responses');
  });

  it('handles 401/403 unauthorized', () => {
    assert.ok(src.includes('401') && src.includes('403'), 'Must handle 401 and 403 responses');
  });

  it('uses AbortSignal.timeout for requests', () => {
    assert.ok(src.includes('AbortSignal.timeout'), 'Must use AbortSignal.timeout for request timeouts');
  });

  it('deduplicates guilds across tokens', () => {
    assert.ok(src.includes('guildMap') || src.includes('Map'), 'Must deduplicate guilds using a Map');
  });

  it('filters channels to text-like types', () => {
    assert.ok(
      src.includes('type === 0') || src.includes('type === 5'),
      'Must filter to text (0) and announcement (5) channel types',
    );
  });

  it('sorts channels by position', () => {
    assert.ok(src.includes('position'), 'Must sort channels by position');
  });
});

// ==========================================================================
// Server routes for Discord discovery
// ==========================================================================

describe('Discord discovery routes (server.ts)', () => {
  const src = readSrc('src/server.ts');

  it('imports createDiscordRest', () => {
    assert.ok(src.includes('createDiscordRest'), 'Must import createDiscordRest from discord-rest');
  });

  it('has GET /api/v1/discord/guilds route', () => {
    assert.ok(
      src.includes('/api/v1/discord/guilds') || src.includes("'/discord/guilds'"),
      'Must have GET /discord/guilds route',
    );
  });

  it('has GET /api/v1/discord/guilds/:guildId/channels route', () => {
    assert.ok(
      src.includes('/discord/guilds/') && src.includes('/channels'),
      'Must have GET /discord/guilds/:guildId/channels route',
    );
  });

  it('guild route requires admin', () => {
    // Find the guild route and check the surrounding block has requireAdmin
    const guildRouteIdx = src.indexOf('/api/v1/discord/guilds');
    assert.ok(guildRouteIdx !== -1, 'Guild route must exist');
    const routeBlock = src.slice(guildRouteIdx, guildRouteIdx + 200);
    assert.ok(routeBlock.includes('requireAdmin'), 'Guild route must require admin auth');
  });
});
