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
// Discord server/channel picker UI in Settings.tsx
// ==========================================================================

describe('Discord picker UI (Settings.tsx)', () => {
  const src = readSrc('dashboard/src/pages/Settings.tsx');

  // 1. Discord browser state variables exist
  describe('Discord browser state variables', () => {
    it('has guilds useState', () => {
      assert.ok(src.includes('useState') && src.includes('setGuilds'), 'Must have guilds state');
    });

    it('has channels useState', () => {
      assert.ok(src.includes('setChannels'), 'Must have channels state');
    });

    it('has selectedGuild useState', () => {
      assert.ok(src.includes('setSelectedGuild'), 'Must have selectedGuild state');
    });

    it('has browseLoading useState', () => {
      assert.ok(src.includes('setBrowseLoading'), 'Must have browseLoading state');
    });

    it('has browseError useState', () => {
      assert.ok(src.includes('setBrowseError'), 'Must have browseError state');
    });

    it('has browseOpen useState', () => {
      assert.ok(src.includes('setBrowseOpen'), 'Must have browseOpen state');
    });
  });

  // 2. resetBrowseState function exists
  it('defines resetBrowseState function', () => {
    assert.ok(src.includes('resetBrowseState'), 'Must define resetBrowseState');
  });

  // 3. fetchGuilds calls the correct API endpoint
  it('fetchGuilds calls /discord/guilds endpoint', () => {
    assert.ok(
      src.includes("'/discord/guilds'") || src.includes('"/discord/guilds"'),
      'Must call /discord/guilds via apiFetch',
    );
  });

  // 4. fetchChannels calls the correct API endpoint
  it('fetchChannels calls /discord/guilds/:id/channels endpoint', () => {
    assert.ok(
      /\/discord\/guilds\/\$\{.*?\}\/channels/.test(src),
      'Must call /discord/guilds/${guildId}/channels via apiFetch',
    );
  });

  // 5. selectChannel sets sourceId and label
  describe('selectChannel sets form fields', () => {
    it('sets sourceId from channel', () => {
      assert.ok(
        src.includes('setAddSourceId(channel.id)') || src.includes('setAddSourceId(ch.id)'),
        'Must set addSourceId to channel id',
      );
    });

    it('sets label with # prefix', () => {
      assert.ok(
        /setAddLabel\(`#\$\{/.test(src) || /setAddLabel\('#/.test(src) || /setAddLabel\(`#/.test(src),
        'Must set addLabel with # prefix',
      );
    });
  });

  // 6. Browser section is conditional on discord source type
  it('browser section is conditional on discord source type', () => {
    assert.ok(
      src.includes("addSource === 'discord'"),
      'Must conditionally render browser only for discord source type',
    );
  });

  // 7. Browse Servers button exists
  it('has Browse Servers button text', () => {
    assert.ok(src.includes('Browse Servers'), 'Must have Browse Servers button');
  });

  // 8. Channel list shows # prefix
  it('channel list renders # prefix for channel names', () => {
    assert.ok(
      src.includes('#</span>') || src.includes('#<'),
      'Must render # prefix before channel name',
    );
  });

  // 9. handleSourceTypeChange resets browse state
  it('handleSourceTypeChange calls resetBrowseState', () => {
    const fnStart = src.indexOf('handleSourceTypeChange');
    assert.ok(fnStart !== -1, 'handleSourceTypeChange must exist');
    const fnBlock = src.slice(fnStart, fnStart + 200);
    assert.ok(
      fnBlock.includes('resetBrowseState'),
      'handleSourceTypeChange must call resetBrowseState',
    );
  });
});
