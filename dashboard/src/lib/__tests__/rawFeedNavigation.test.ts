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
  it('builds focused feed hrefs with sourceId and itemId', () => {
    expect(buildRawFeedFocusHref('guild:1234', 'item-1')).toBe('/feed?sourceId=guild%3A1234&itemId=item-1');
  });

  it('adds context params only when a route override is present', () => {
    expect(buildRawItemHref('item-1')).toBe('/items/item-1');
    expect(buildRawItemHref('item-1', { contextSize: 5 })).toBe('/items/item-1?context=5');
    expect(buildRawFeedFocusHref('guild:1234', 'item-1', { contextSize: 5 })).toBe(
      '/feed?sourceId=guild%3A1234&itemId=item-1&context=5',
    );
  });

  it('builds live feed hrefs with sourceId only', () => {
    expect(buildRawFeedSourceHref('guild:1234')).toBe('/feed?sourceId=guild%3A1234');
  });

  it('builds item-based focused feed hrefs only for supported sources', () => {
    expect(buildRawFeedFocusHrefForItem({ id: 'item-1', source: 'discord', sourceId: 'guild:1234' })).toBe(
      '/feed?sourceId=guild%3A1234&itemId=item-1',
    );
    expect(buildRawFeedFocusHrefForItem({ id: 'item-2', source: 'rss', sourceId: 'feed-1' })).toBeNull();
  });

  it('builds item-based live feed hrefs only for supported sources', () => {
    expect(buildRawFeedSourceHrefForItem({ source: 'discord', sourceId: 'guild:1234' })).toBe(
      '/feed?sourceId=guild%3A1234',
    );
    expect(buildRawFeedSourceHrefForItem({ source: 'twitter', sourceId: 'handle' })).toBeNull();
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

  it('supports raw-feed navigation only for discord items', () => {
    expect(supportsRawFeedNavigation('discord')).toBe(true);
    expect(supportsRawFeedNavigation('rss')).toBe(false);
  });
});
