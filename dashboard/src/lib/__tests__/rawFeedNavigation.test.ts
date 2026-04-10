import { describe, expect, it } from 'vitest';
import {
  buildRawItemHref,
  buildRawFeedFocusHref,
  buildRawFeedFocusHrefForItem,
  buildRawFeedSourceHref,
  buildRawFeedSourceHrefForItem,
  isFocusedRawFeedActive,
  readRawRouteContextSize,
  supportsRawFeedNavigation,
  toRawRouteContextParam,
} from '../rawFeedNavigation';

describe('rawFeedNavigation', () => {
  it('builds focused feed hrefs with source, sourceId, and itemId', () => {
    expect(buildRawFeedFocusHref('discord', 'guild:1234', 'item-1')).toBe(
      '/feed?source=discord&sourceId=guild%3A1234&itemId=item-1',
    );
  });

  it('adds context params only when a route override is present', () => {
    expect(buildRawItemHref('item-1')).toBe('/items/item-1');
    expect(buildRawItemHref('item-1', { contextSize: 5 })).toBe('/items/item-1?context=5');
    expect(buildRawFeedFocusHref('discord', 'guild:1234', 'item-1', { contextSize: 5 })).toBe(
      '/feed?source=discord&sourceId=guild%3A1234&itemId=item-1&context=5',
    );
  });

  it('builds live feed hrefs with source and sourceId', () => {
    expect(buildRawFeedSourceHref('discord', 'guild:1234')).toBe('/feed?source=discord&sourceId=guild%3A1234');
  });

  it('builds item-based focused feed hrefs for discord and twitter, not for rss/news', () => {
    expect(buildRawFeedFocusHrefForItem({ id: 'item-1', source: 'discord', sourceId: 'guild:1234' })).toBe(
      '/feed?source=discord&sourceId=guild%3A1234&itemId=item-1',
    );
    expect(buildRawFeedFocusHrefForItem({ id: 'item-3', source: 'twitter', sourceId: 'handle' })).toBe(
      '/feed?source=twitter&sourceId=handle&itemId=item-3',
    );
    expect(buildRawFeedFocusHrefForItem({ id: 'item-2', source: 'rss', sourceId: 'feed-1' })).toBeNull();
    expect(buildRawFeedFocusHrefForItem({ id: 'item-4', source: 'news', sourceId: 'news-1' })).toBeNull();
  });

  it('builds item-based live feed hrefs for discord and twitter, not for rss/news', () => {
    expect(buildRawFeedSourceHrefForItem({ source: 'discord', sourceId: 'guild:1234' })).toBe(
      '/feed?source=discord&sourceId=guild%3A1234',
    );
    expect(buildRawFeedSourceHrefForItem({ source: 'twitter', sourceId: 'handle' })).toBe(
      '/feed?source=twitter&sourceId=handle',
    );
    expect(buildRawFeedSourceHrefForItem({ source: 'rss', sourceId: 'feed-1' })).toBeNull();
    expect(buildRawFeedSourceHrefForItem({ source: 'news', sourceId: 'news-1' })).toBeNull();
  });

  it('distinguishes colliding sourceIds by source in feed hrefs', () => {
    const discordFocusHref = buildRawFeedFocusHref('discord', 'collision', 'item-1');
    const twitterFocusHref = buildRawFeedFocusHref('twitter', 'collision', 'item-1');
    const discordSourceHref = buildRawFeedSourceHref('discord', 'collision');
    const twitterSourceHref = buildRawFeedSourceHref('twitter', 'collision');

    expect(discordFocusHref).toBe('/feed?source=discord&sourceId=collision&itemId=item-1');
    expect(twitterFocusHref).toBe('/feed?source=twitter&sourceId=collision&itemId=item-1');
    expect(discordFocusHref).not.toBe(twitterFocusHref);

    expect(discordSourceHref).toBe('/feed?source=discord&sourceId=collision');
    expect(twitterSourceHref).toBe('/feed?source=twitter&sourceId=collision');
    expect(discordSourceHref).not.toBe(twitterSourceHref);
  });

  it('normalizes route context sizes against defaults and target caps', () => {
    expect(readRawRouteContextSize(null, 2, 5)).toBe(2);
    expect(readRawRouteContextSize('4', 2, 5)).toBe(4);
    expect(readRawRouteContextSize('99', 2, 5)).toBe(5);
    expect(readRawRouteContextSize('abc', 2, 5)).toBe(2);

    expect(toRawRouteContextParam(2, 2, 5)).toBeUndefined();
    expect(toRawRouteContextParam(3, 2, 5)).toBe(3);
    expect(toRawRouteContextParam(6, 2, 5)).toBe(5);
    expect(toRawRouteContextParam(2, 3, 6)).toBeUndefined();
  });

  it('flags focused raw-feed mode only when the focused item should be pinned', () => {
    expect(
      isFocusedRawFeedActive({
        focusedItemId: 'item-1',
        focusedItemVisible: false,
        requestedSourceId: 'guild:1234',
        selectedSource: 'guild:1234',
      }),
    ).toBe(true);

    expect(
      isFocusedRawFeedActive({
        focusedItemId: '',
        focusedItemVisible: false,
        requestedSourceId: 'guild:1234',
        selectedSource: 'guild:1234',
      }),
    ).toBe(false);

    expect(
      isFocusedRawFeedActive({
        focusedItemId: 'item-1',
        focusedItemVisible: true,
        requestedSourceId: 'guild:1234',
        selectedSource: 'guild:1234',
      }),
    ).toBe(false);
  });

  it('supports raw-feed navigation for discord and twitter, not for rss/news', () => {
    expect(supportsRawFeedNavigation('discord')).toBe(true);
    expect(supportsRawFeedNavigation('twitter')).toBe(true);
    expect(supportsRawFeedNavigation('rss')).toBe(false);
    expect(supportsRawFeedNavigation('news')).toBe(false);
  });
});
