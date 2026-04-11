# Discord REST Ingestion

Reference spec for the live Discord ingestion path in Podders v2.
Discord sources are polled over the REST API. There is no Gateway session,
heartbeat loop, or resume flow in production.

## 1. Overview

The scheduler polls Discord channels through
`src/ingest/discord-rest.ts`. Two surfaces live there:

- `createDiscordRest(tokens, log)` for guild and channel discovery in the
  dashboard settings flow
- `pollDiscordChannel(channelId, lastId, tokens, log)` for message ingestion

REST endpoints used:

- `GET /users/@me/guilds?limit=200`
- `GET /guilds/{guildId}/channels`
- `GET /channels/{channelId}/messages?limit=50`
- `GET /channels/{channelId}/messages?limit=50&after={lastId}`

All requests go to `https://discord.com/api/v10`.

## 2. Token Model

Runtime tokens come from:

- `DISCORD_TOKENS` in the environment
- managed tokens stored in Postgres and decrypted at startup

`loadAllTokens()` deduplicates by raw token string. Managed tokens may carry
an optional per-token proxy URL; `discord-rest.ts` converts that to an
`undici` `ProxyAgent`.

There is no long-lived token state in the REST poller. Each poll builds a
short-lived runtime list, issues requests, then closes any proxy dispatchers
in a `finally` block.

## 3. Guild and Channel Discovery

`createDiscordRest()` powers the dashboard source picker.

### `getGuilds()`

- Iterates every active token
- Calls `/users/@me/guilds?limit=200`
- Deduplicates guilds by ID
- Sorts by guild name before returning

### `getChannels(guildId)`

- Tries tokens in order until one can read the guild
- Calls `/guilds/{guildId}/channels`
- Keeps text-like channels only:
  - type `0` = text
  - type `5` = announcement
- Maps Discord snake_case to camelCase and sorts by `position`

### `updateTokens(newTokens)`

Replaces the in-memory token list and closes old proxy dispatchers before the
new tokens are used.

## 4. Message Polling

`pollDiscordChannel(channelId, lastId, tokens, log)` is the production ingest
path.

### Poll flow

1. Build short-lived token runtimes from the supplied tokens.
2. Request the first page with `limit=50`, adding `after={lastId}` when a prior
   cursor exists.
3. Try tokens in order until one returns a successful JSON response.
4. If no token succeeds, return `{ fetchFailed: true }` so the caller does not
   advance `last_fetched_at`.
5. Reuse the successful token for pagination while Discord keeps returning full
   pages.

Polling caps:

- `PAGE_SIZE = 50`
- `MAX_PAGES = 5`
- Maximum of 250 messages per poll cycle

Messages are sorted oldest-first before mapping so downstream normalization and
summarization see them in chronological order. The newest fetched Discord
message ID becomes the next `lastId`.

## 5. RawItem Mapping

The REST mapper keeps the same user-facing semantics the old adapter had, but
without a socket layer.

### Filters

- Skip bot-authored messages
- Keep only message types `0` (default) and `19` (reply)
- Drop items whose assembled content is empty

### Content construction

`content` is assembled in this order:

1. Reply context as `> {referenced_message.content.slice(0, 200)}`
2. Main message content
3. Embed descriptions

Embed titles are not used. Reaction counts are not fetched. `engagement` stays
hardcoded to `0`.

### Attachments

Attachment URLs are kept only when they are:

- valid HTTPS URLs
- hosted on `cdn.discordapp.com` or `media.discordapp.net`

All valid attachment URLs go into `attachments`. Image-like attachments are
also exposed in `metadata.imageUrls` when either:

- `content_type` starts with `image/`, or
- the URL path ends in `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, or `.svg`

### Timestamp fallback

`timestamp` is parsed from the Discord ISO string. If parsing yields `NaN`, the
poller logs a warning and falls back to `Date.now()`.

### Output shape

```ts
{
  id: ulid(),
  source: 'discord',
  sourceId: channelId,
  author: msg.author.username,
  content,
  timestamp,
  engagement: 0,
  attachments,
  metadata: {
    guildId: msg.guild_id ?? null,
    messageId: msg.id,
    imageUrls,
  },
}
```

## 6. Failure Model

`discordFetch()` treats these cases as token-level failures and returns `null`:

- `401` or `403`: token unauthorized
- `429`: rate limited
- any other non-2xx response
- network or fetch exceptions

The caller then tries the next token. If every token fails, the source poll is
treated as failed and `src/index.ts` leaves `last_fetched_at` untouched so the
health monitor can detect the stall.

There is no token-disable circuit inside `discord-rest.ts`. The runtime simply
uses the first token that works for a given request.

## 7. Operational Notes

- Discord sources use the same fixed-interval source scheduler as Twitter, RSS,
  and news. There is no special Gateway or Poisson-based claim path.
- Successful polls record which token was used so managed tokens can update
  `last_used_at`.
- Because each cycle caps at 250 fetched messages, a very hot channel can still
  outrun its configured `poll_interval`. That tradeoff is acceptable for the
  current single-process design.
- Discovery and ingestion are both safe to restart because all durable cursor
  state lives in `source_state.last_id`, not in a Discord session.
