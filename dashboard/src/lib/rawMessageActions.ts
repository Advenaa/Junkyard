import type { RawMessageCardAction } from '../components/RawMessageCard';
import {
  buildRawFeedFocusHref,
  buildRawFeedFocusHrefForItem,
  buildRawFeedSourceHrefForItem,
  buildRawItemHref,
} from './rawFeedNavigation';

type RawMessageActionTone = 'accent' | 'muted';

interface RawItemTarget {
  id: string;
  source: string;
  sourceId: string;
  url?: string | null;
}

interface RawMessageActionOptions {
  label?: string;
  tone?: RawMessageActionTone;
  ariaLabel?: string;
}

interface RawMessageRouteOptions {
  feedContextSize?: number;
  itemContextSize?: number;
}

function buildOpenRawItemAction(
  itemId: string,
  { label = 'Open item', tone = 'accent', ariaLabel }: RawMessageActionOptions = {},
  { itemContextSize }: RawMessageRouteOptions = {},
): RawMessageCardAction {
  return {
    href: buildRawItemHref(itemId, { contextSize: itemContextSize }),
    label,
    tone,
    ...(ariaLabel ? { ariaLabel } : {}),
  };
}

function buildRawFeedFocusAction(
  source: string,
  sourceId: string,
  itemId: string,
  { label = 'Focus here', tone = 'accent', ariaLabel }: RawMessageActionOptions = {},
  { feedContextSize }: RawMessageRouteOptions = {},
): RawMessageCardAction {
  return {
    href: buildRawFeedFocusHref(source, sourceId, itemId, { contextSize: feedContextSize }),
    label,
    tone,
    ...(ariaLabel ? { ariaLabel } : {}),
  };
}

function buildRawFeedFocusActionForItem(
  item: RawItemTarget,
  options?: RawMessageActionOptions,
  routeOptions: RawMessageRouteOptions = {},
): RawMessageCardAction[] {
  const href = buildRawFeedFocusHrefForItem(item, { contextSize: routeOptions.feedContextSize });
  if (!href) return [];

  return [
    {
      href,
      label: options?.label ?? 'Focus here',
      tone: options?.tone ?? 'accent',
      ...(options?.ariaLabel ? { ariaLabel: options.ariaLabel } : {}),
    },
  ];
}

function buildRawFeedSourceActionForItem(
  item: Pick<RawItemTarget, 'source' | 'sourceId'>,
  { label = 'Resume live feed', tone = 'muted', ariaLabel }: RawMessageActionOptions = {},
): RawMessageCardAction[] {
  const href = buildRawFeedSourceHrefForItem(item);
  if (!href) return [];

  return [
    {
      href,
      label,
      tone,
      ...(ariaLabel ? { ariaLabel } : {}),
    },
  ];
}

function buildOpenSourceLinkAction(url: string): RawMessageCardAction {
  return {
    href: url,
    label: 'Open source link',
    tone: 'muted',
    external: true,
  };
}

export function buildRawFeedSequenceActions(
  source: string,
  sourceId: string,
  { previousItemId, nextItemId }: { previousItemId?: string; nextItemId?: string },
  routeOptions: RawMessageRouteOptions = {},
): RawMessageCardAction[] {
  return [
    ...(previousItemId
      ? [
          buildRawFeedFocusAction(
            source,
            sourceId,
            previousItemId,
            {
              label: 'Previous in source',
            },
            routeOptions,
          ),
        ]
      : []),
    ...(nextItemId
      ? [
          buildRawFeedFocusAction(
            source,
            sourceId,
            nextItemId,
            {
              label: 'Next in source',
            },
            routeOptions,
          ),
        ]
      : []),
  ];
}

export function buildRawFeedMessageActions(
  itemId: string,
  routeOptions: RawMessageRouteOptions = {},
): RawMessageCardAction[] {
  return [buildOpenRawItemAction(itemId, {}, routeOptions)];
}

export function buildFocusedRawFeedContextActions(
  source: string,
  sourceId: string,
  item: Pick<RawItemTarget, 'id' | 'url'>,
  routeOptions: RawMessageRouteOptions = {},
): RawMessageCardAction[] {
  return [
    buildOpenRawItemAction(item.id, { tone: 'muted' }, routeOptions),
    ...(item.url ? [buildOpenSourceLinkAction(item.url)] : []),
    buildRawFeedFocusAction(source, sourceId, item.id, {}, routeOptions),
  ];
}

export function buildFocusedRawFeedPrimaryActions(
  item: Pick<RawItemTarget, 'id' | 'url'>,
  routeOptions: RawMessageRouteOptions = {},
): RawMessageCardAction[] {
  return [
    buildOpenRawItemAction(item.id, {}, routeOptions),
    ...(item.url ? [buildOpenSourceLinkAction(item.url)] : []),
  ];
}

export function buildRawItemContextActions(
  item: RawItemTarget,
  routeOptions: RawMessageRouteOptions = {},
): RawMessageCardAction[] {
  return [
    ...buildRawFeedFocusActionForItem(
      item,
      {
        label: 'View in feed',
        tone: 'accent',
        ariaLabel: `View raw feed around ${item.id}`,
      },
      routeOptions,
    ),
    ...(item.url ? [buildOpenSourceLinkAction(item.url)] : []),
    buildOpenRawItemAction(
      item.id,
      {
        label: 'Open item',
        tone: 'muted',
        ariaLabel: `Open raw item ${item.id}`,
      },
      routeOptions,
    ),
  ];
}

export function buildRawItemDetailActions(
  item: RawItemTarget,
  routeOptions: RawMessageRouteOptions = {},
): RawMessageCardAction[] {
  return [
    ...buildRawFeedFocusActionForItem(
      item,
      {
        label: 'View in focused feed',
        tone: 'accent',
      },
      routeOptions,
    ),
    ...buildRawFeedSourceActionForItem(item, {
      label: 'Resume live feed',
      tone: 'muted',
    }),
    ...(item.url ? [buildOpenSourceLinkAction(item.url)] : []),
  ];
}
