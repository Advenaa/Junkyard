# Skill: podders-source

Scaffold a new ingest source adapter for the Podders v2 pipeline.

**Invocation:** `/podders-source <source-type>` (e.g., `/podders-source telegram`, `/podders-source reddit`)

The source type is provided via `$ARGUMENTS`. If `$ARGUMENTS` is empty, ask the user for the source type name before proceeding.

---

## Steps

### 1. Create the adapter file

Create `src/ingest/$ARGUMENTS.ts` following the established adapter patterns.

**For poll-based sources** (like Twitter, RSS), use this template:

```typescript
import { ulid } from 'ulid';
import { fetchValidated } from '../url-validator.js';
import type { Config } from '../config.js';
import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';
import type { RawItem } from './rss.js';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

// TODO: Add API response schemas using zod for validation

const MAX_ITEMS_PER_POLL = 50;

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export function create<SourceTypePascalCase>Adapter(
  config: Config,
  pool: Pool,
  log: Logger,
  onItem?: (item: RawItem) => Promise<void>,
) {
  async function poll(
    sourceId: string,
    lastId: string | null,
  ): Promise<{ items: RawItem[]; lastId: string | null }> {
    const empty = { items: [], lastId: null };

    // TODO: Check for required API key in config
    // if (!config.<sourceType>ApiKey) return empty;

    try {
      // TODO: Implement API call using fetchValidated() for outbound HTTP
      // const { response } = await fetchValidated(url, {
      //   signal: AbortSignal.timeout(15_000),
      // });

      const items: RawItem[] = []; // TODO: Map API response to RawItem[]

      // Template for mapping each result to a RawItem:
      // {
      //   id: ulid(),
      //   source: '$ARGUMENTS',
      //   sourceId,
      //   author: '...',
      //   content: '...',
      //   timestamp: Date.now(),
      //   url: undefined,
      //   engagement: -1, // sentinel for unknown; compute if metrics available
      //   metadata: {},
      // }

      const newLastId = lastId; // TODO: Track cursor/pagination state

      return { items, lastId: newLastId };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ sourceId, error: message }, '$ARGUMENTS poll failed');
      return { items: [], lastId };
    }
  }

  return { poll };
}
```

**For push-based sources** (like Discord gateway), use this template instead:

```typescript
import { ulid } from 'ulid';
import type { Config } from '../config.js';
import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';
import type { RawItem } from './rss.js';

export function create<SourceTypePascalCase>Adapter(
  config: Config,
  pool: Pool,
  log: Logger,
  onItem?: (item: RawItem) => Promise<void>,
) {
  async function connect(): Promise<void> {
    // TODO: Establish persistent connection (WebSocket, long-poll, etc.)
    // Call onItem?.() for each incoming message
  }

  async function disconnect(): Promise<void> {
    // TODO: Clean shutdown of connection
  }

  return { connect, disconnect };
}
```

**Key rules for the adapter:**
- All items MUST conform to `RawItem` from `src/ingest/rss.ts`
- Use `ulid()` for all item IDs
- Set `engagement: -1` for sources without engagement metrics (sentinel for "unknown")
- Use `fetchValidated()` from `src/url-validator.ts` for ALL outbound HTTP requests (SSRF protection)
- Use `zod` to validate API responses (see `src/ingest/twitter.ts` for the pattern)
- Include proper error handling: catch, log with context, return empty result
- Handle rate limiting (429s) with backoff
- Handle auth failures (401s) gracefully -- consider halting the source
- Cap items per poll to prevent unbounded processing

### 2. Update the `RawItem.source` union type

In `src/ingest/rss.ts`, add `'$ARGUMENTS'` to the `source` field union type in the `RawItem` interface:

```typescript
export interface RawItem {
  // ...
  source: 'discord' | 'twitter' | 'news' | 'rss' | '$ARGUMENTS';
  // ...
}
```

### 3. Wire into `src/index.ts`

Add three things to `src/index.ts`:

**a) Import the adapter** (near the other ingest imports around line 22-28):
```typescript
import { create<SourceTypePascalCase>Adapter } from './ingest/$ARGUMENTS.js';
```

**b) Instantiate the adapter** (after the Twitter adapter instantiation):
```typescript
const <sourceType>Adapter = create<SourceTypePascalCase>Adapter(config, pool, log);
```

**c) Add to the poll switch** in `onSourcePollTick()` (inside the `if/else if` chain around line 135-148):

For poll-based:
```typescript
} else if (src.source === '$ARGUMENTS') {
  const result = await <sourceType>Adapter.poll(src.source_id, lastId);
  items = result.items;
  newLastId = result.lastId ?? lastId;
}
```

For push-based, follow the Discord pattern:
```typescript
} else if (src.source === '$ARGUMENTS') {
  // Push-based — no polling needed
  await updateSourceState(pool, src.source, src.source_id, now, lastId);
  return;
}
```

**d) For push-based sources**, also add `connect()` in the startup section and `disconnect()` in the shutdown/cleanup section, following the Discord adapter pattern.

### 4. Update source validation in `src/server.ts`

Find the source enum in the POST `/api/v1/sources` route schema and add the new type:

```typescript
source: { type: 'string', enum: ['discord', 'twitter', 'rss', 'news', '$ARGUMENTS'] },
```

### 5. Migration (if needed)

If the database has a CHECK constraint on the `source` column in the `items` or `source_state` tables, create a new migration in `src/db/migrations.ts` to add the new source type to the constraint. Check existing migrations first to see if this is needed.

### 6. Environment variables

If the new source requires API keys or credentials, document them:

1. Add the new env var to `src/config.ts` in `loadConfig()`
2. Add to the `Config` type
3. Add to the secrets masking list in `createLogger()` if it's a secret
4. Document in `AGENTS.md` under the Environment Variables table

---

## Checklist before done

- [ ] Adapter file created at `src/ingest/$ARGUMENTS.ts`
- [ ] `RawItem.source` union updated in `src/ingest/rss.ts`
- [ ] Import added to `src/index.ts`
- [ ] Adapter instantiated in `src/index.ts`
- [ ] Poll/connect logic added to `onSourcePollTick()` or startup
- [ ] Source enum updated in `src/server.ts`
- [ ] Migration added if CHECK constraints exist on source column
- [ ] New env vars documented (if any)
- [ ] `npm run build` passes with no TypeScript errors
