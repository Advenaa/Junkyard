import { describe, expect, it } from 'vitest';
import {
  buildFocusedRawFeedContextActions,
  buildFocusedRawFeedPrimaryActions,
  buildRawFeedMessageActions,
  buildRawItemContextActions,
  buildRawItemDetailActions,
} from '../rawMessageActions';

describe('rawMessageActions', () => {
  it('builds raw item detail actions for feed navigation, live return, and source links', () => {
    expect(
      buildRawItemDetailActions({
        id: 'item-1',
        source: 'discord',
        sourceId: 'guild:alpha',
        url: 'https://example.com/source',
      }),
    ).toEqual([
      {
        href: '/feed?source=discord&sourceId=guild%3Aalpha&itemId=item-1',
        label: 'View in focused feed',
        tone: 'accent',
      },
      {
        href: '/feed?source=discord&sourceId=guild%3Aalpha',
        label: 'Resume live feed',
        tone: 'muted',
      },
      {
        href: 'https://example.com/source',
        label: 'Open source link',
        tone: 'muted',
        external: true,
      },
    ]);
  });

  it('threads preserved route context through feed and raw-item actions', () => {
    expect(
      buildRawItemContextActions(
        {
          id: 'item-1',
          source: 'discord',
          sourceId: 'guild:alpha',
          url: 'https://example.com/source',
        },
        {
          feedContextSize: 5,
          itemContextSize: 6,
        },
      ),
    ).toEqual([
      {
        href: '/feed?source=discord&sourceId=guild%3Aalpha&itemId=item-1&context=5',
        label: 'View in feed',
        tone: 'accent',
        ariaLabel: 'View raw feed around item-1',
      },
      {
        href: 'https://example.com/source',
        label: 'Open source link',
        tone: 'muted',
        external: true,
      },
      {
        href: '/items/item-1?context=6',
        label: 'Open item',
        tone: 'muted',
        ariaLabel: 'Open raw item item-1',
      },
    ]);

    expect(
      buildFocusedRawFeedPrimaryActions(
        {
          id: 'item-focus',
          url: 'https://example.com/focused-item',
        },
        {
          itemContextSize: 5,
        },
      ),
    ).toEqual([
      {
        href: '/items/item-focus?context=5',
        label: 'Open item',
        tone: 'accent',
      },
      {
        href: 'https://example.com/focused-item',
        label: 'Open source link',
        tone: 'muted',
        external: true,
      },
    ]);
  });

  it('keeps raw item context actions usable even when feed navigation is unsupported', () => {
    expect(
      buildRawItemContextActions({
        id: 'item-1',
        source: 'rss',
        sourceId: 'feed:macro',
        url: 'https://example.com/macro',
      }),
    ).toEqual([
      {
        href: 'https://example.com/macro',
        label: 'Open source link',
        tone: 'muted',
        external: true,
      },
      {
        href: '/items/item-1',
        label: 'Open item',
        tone: 'muted',
        ariaLabel: 'Open raw item item-1',
      },
    ]);
  });

  it('builds focused-feed actions for context cards and the primary pinned citation', () => {
    expect(
      buildFocusedRawFeedContextActions(
        'discord',
        'guild:alpha',
        {
          id: 'item-2',
          url: 'https://example.com/context-item',
        },
        {
          feedContextSize: 5,
          itemContextSize: 5,
        },
      ),
    ).toEqual([
      {
        href: '/items/item-2?context=5',
        label: 'Open item',
        tone: 'muted',
      },
      {
        href: 'https://example.com/context-item',
        label: 'Open source link',
        tone: 'muted',
        external: true,
      },
      {
        href: '/feed?source=discord&sourceId=guild%3Aalpha&itemId=item-2&context=5',
        label: 'Focus here',
        tone: 'accent',
      },
    ]);

    expect(
      buildFocusedRawFeedPrimaryActions({
        id: 'item-focus',
        url: 'https://example.com/source',
      }),
    ).toEqual([
      {
        href: '/items/item-focus',
        label: 'Open item',
        tone: 'accent',
      },
      {
        href: 'https://example.com/source',
        label: 'Open source link',
        tone: 'muted',
        external: true,
      },
    ]);
  });

  it('distinguishes focused-feed context actions for colliding source ids across source kinds', () => {
    const discordActions = buildFocusedRawFeedContextActions('discord', 'collision', { id: 'item-1' });
    const twitterActions = buildFocusedRawFeedContextActions('twitter', 'collision', { id: 'item-1' });

    expect(discordActions[1]).toEqual({
      href: '/feed?source=discord&sourceId=collision&itemId=item-1',
      label: 'Focus here',
      tone: 'accent',
    });
    expect(twitterActions[1]).toEqual({
      href: '/feed?source=twitter&sourceId=collision&itemId=item-1',
      label: 'Focus here',
      tone: 'accent',
    });
    expect(discordActions[1]?.href).not.toBe(twitterActions[1]?.href);
  });

  it('builds the live-feed item drilldown action', () => {
    expect(buildRawFeedMessageActions('item-3')).toEqual([
      {
        href: '/items/item-3',
        label: 'Open item',
        tone: 'accent',
      },
    ]);
  });
});
