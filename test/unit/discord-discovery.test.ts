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
  const src = readServerSource();

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

  it('guild route applies toCamelCase', () => {
    const guildRouteIdx = src.indexOf("'/api/v1/discord/guilds'");
    assert.ok(guildRouteIdx !== -1, 'Guild route must exist');
    const routeBlock = src.slice(guildRouteIdx, guildRouteIdx + 300);
    assert.ok(routeBlock.includes('toCamelCase'), 'Guild route must apply toCamelCase to response');
  });

  it('channel route applies toCamelCase', () => {
    const channelRouteIdx = src.indexOf("'/api/v1/discord/guilds/:guildId/channels'");
    assert.ok(channelRouteIdx !== -1, 'Channel route must exist');
    const routeBlock = src.slice(channelRouteIdx, channelRouteIdx + 300);
    assert.ok(routeBlock.includes('toCamelCase'), 'Channel route must apply toCamelCase to response');
  });
});

// ==========================================================================
// Discord snowflake validation on POST /sources
// ==========================================================================

describe('Discord snowflake validation (server.ts)', () => {
  const src = readServerSource();

  it('validates discord sourceId as snowflake pattern', () => {
    // Must have a regex check for 17-20 digit snowflakes for discord sources
    const snowflakeCheck = src.match(/source\s*===\s*'discord'.*\\d\{17,20\}/s);
    assert.ok(snowflakeCheck, 'POST /sources must validate discord sourceId as 17-20 digit snowflake');
  });

  it('returns 400 for invalid discord snowflake', () => {
    const postSourcesIdx = src.indexOf("'/api/v1/sources'");
    assert.ok(postSourcesIdx !== -1, 'POST /sources route must exist');
    const routeBlock = src.slice(postSourcesIdx, postSourcesIdx + 2000);
    assert.ok(
      routeBlock.includes('snowflake') || routeBlock.includes('17-20 digit'),
      'Error message must mention snowflake format',
    );
  });
});
