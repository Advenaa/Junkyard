import WebSocket from 'ws';
import { ulid } from 'ulid';
import type { Config } from '../config.js';
import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';
import type { RawItem } from './rss.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenState {
  index: number;
  status: 'idle' | 'connecting' | 'connected' | 'backoff' | 'disabled';
  sessionId: string | null;
  resumeUrl: string | null;
  lastSeq: number | null;
  assignedChannels: Set<string>;
  errorCount: number;
  connectedAt: number | null;
}

interface GatewayPayload {
  op: number;
  d: unknown;
  s: number | null;
  t: string | null;
}

interface HelloData {
  heartbeat_interval: number;
}

interface ReadyData {
  session_id: string;
  resume_gateway_url: string;
}

interface MessageAuthor {
  username: string;
  bot?: boolean;
}

interface MessageAttachment {
  url: string;
  content_type?: string;
}

interface MessageEmbed {
  description?: string;
}

interface ReferencedMessage {
  content?: string;
}

interface MessageCreateData {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: MessageAuthor;
  content: string;
  timestamp: string;
  type: number;
  attachments?: MessageAttachment[];
  embeds?: MessageEmbed[];
  referenced_message?: ReferencedMessage | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';

const FATAL_CLOSE_CODES: ReadonlySet<number> = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
// 4005 = Already authenticated (resumable)
const RESUMABLE_CLOSE_CODES: ReadonlySet<number> = new Set([4000, 4001, 4002, 4003, 4005, 4009, 1001]);
const NON_RESUMABLE_CLOSE_CODES: ReadonlySet<number> = new Set([4007, 4008, 1000]);

const MAX_BACKOFF_MS = 60_000;
const MAX_CONSECUTIVE_ERRORS = 20;

const DISCORD_CDN_HOSTS: ReadonlySet<string> = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

function isValidDiscordUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && DISCORD_CDN_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}
const IDENTIFY_PROPERTIES = {
  os: 'Linux',
  browser: 'Chrome',
  device: '',
  system_locale: 'en-US',
  browser_user_agent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  browser_version: '124.0.0.0',
  os_version: '',
  referrer: '',
  referring_domain: '',
  release_channel: 'stable',
  client_build_number: 291963,
} as const;

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getDiscordChannels(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ source_id: string }>(
    "SELECT source_id FROM sources WHERE source = 'discord' AND enabled = true",
  );
  return rows.map((r) => r.source_id);
}

function isImageAttachment(attachment: MessageAttachment): boolean {
  if (attachment.content_type?.startsWith('image/')) return true;
  try {
    const path = new URL(attachment.url).pathname.toLowerCase();
    return [...IMAGE_EXTENSIONS].some((ext) => path.endsWith(ext));
  } catch {
    return false;
  }
}

function isHelloData(d: unknown): d is HelloData {
  return (
    typeof d === 'object' &&
    d !== null &&
    'heartbeat_interval' in d &&
    typeof (d as HelloData).heartbeat_interval === 'number'
  );
}

function isReadyData(d: unknown): d is ReadyData {
  return (
    typeof d === 'object' &&
    d !== null &&
    'session_id' in d &&
    typeof (d as ReadyData).session_id === 'string' &&
    'resume_gateway_url' in d &&
    typeof (d as ReadyData).resume_gateway_url === 'string'
  );
}

function isMessageCreateData(d: unknown): d is MessageCreateData {
  if (typeof d !== 'object' || d === null) return false;
  const msg = d as Record<string, unknown>;
  return (
    typeof msg['id'] === 'string' &&
    typeof msg['channel_id'] === 'string' &&
    typeof msg['content'] === 'string' &&
    typeof msg['timestamp'] === 'string' &&
    typeof msg['type'] === 'number' &&
    typeof msg['author'] === 'object' &&
    msg['author'] !== null
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function backoffMs(attempt: number): number {
  return Math.min(Math.pow(2, attempt) * 2000, MAX_BACKOFF_MS);
}

// ---------------------------------------------------------------------------
// Token connection manager
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Backpressure: bounded concurrency for onMessage pipeline entry
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_MESSAGES = 5;
export const MAX_QUEUE_SIZE = 100;
const DROP_FLUSH_INTERVAL_MS = 30_000;

/**
 * Accumulates queue-overflow drop counts per channel and flushes them
 * periodically as health_events so there is an audit trail.
 */
class DropAccumulator {
  private counts = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly log: Logger,
    private readonly tokenIndex: number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, DROP_FLUSH_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Best-effort final flush (fire-and-forget on shutdown)
    void this.flush();
  }

  record(channelId: string): void {
    this.counts.set(channelId, (this.counts.get(channelId) ?? 0) + 1);
  }

  private async flush(): Promise<void> {
    if (this.counts.size === 0) return;

    const snapshot = new Map(this.counts);
    this.counts.clear();

    let totalDropped = 0;
    const channelBreakdown: Record<string, number> = {};
    for (const [ch, count] of snapshot) {
      totalDropped += count;
      channelBreakdown[ch] = count;
    }

    try {
      const id = ulid();
      const now = Date.now();
      await this.pool.query(
        `INSERT INTO health_events (id, category, severity, message, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          'queue_overflow',
          'warn',
          `Dropped ${totalDropped} Discord message(s) due to queue overflow on token ${this.tokenIndex}`,
          JSON.stringify({ tokenIndex: this.tokenIndex, totalDropped, channels: channelBreakdown }),
          now,
        ],
      );
      this.log.warn(
        { tokenIndex: this.tokenIndex, totalDropped, channels: channelBreakdown },
        'flushed queue overflow drops to health_events',
      );
    } catch (err: unknown) {
      this.log.error({ err, tokenIndex: this.tokenIndex }, 'failed to flush queue overflow drops');
      // Re-add counts so they aren't lost
      for (const [ch, count] of snapshot) {
        this.counts.set(ch, (this.counts.get(ch) ?? 0) + count);
      }
    }
  }
}

async function withConcurrencyLimit<T>(
  state: { active: number; queue: (() => void)[] },
  fn: () => Promise<T>,
): Promise<T> {
  if (state.active >= MAX_CONCURRENT_MESSAGES) {
    if (state.queue.length >= MAX_QUEUE_SIZE) {
      throw new Error('message queue full, dropping message');
    }
    await new Promise<void>((resolve) => state.queue.push(resolve));
  }
  state.active++;
  try {
    return await fn();
  } finally {
    state.active--;
    const next = state.queue.shift();
    if (next) next();
  }
}

// ---------------------------------------------------------------------------
// Token connection manager
// ---------------------------------------------------------------------------

class TokenConnection {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatJitterTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatAcked = true;
  private reconnectAttempt = 0;
  private destroyed = false;
  private readonly concurrency = { active: 0, queue: [] as (() => void)[] };
  private readonly drops: DropAccumulator;

  readonly state: TokenState;

  constructor(
    private readonly tokenIndex: number,
    private readonly token: string,
    private readonly log: Logger,
    private readonly onMessage: (item: RawItem) => Promise<void>,
    private readonly onDeath: (index: number) => void,
    pool: Pool,
  ) {
    this.drops = new DropAccumulator(pool, log, tokenIndex);
    this.state = {
      index: tokenIndex,
      status: 'idle',
      sessionId: null,
      resumeUrl: null,
      lastSeq: null,
      assignedChannels: new Set(),
      errorCount: 0,
      connectedAt: null,
    };
  }

  // ---- public API ----

  async connect(): Promise<void> {
    if (this.destroyed) return;
    this.drops.start();
    this.state.status = 'connecting';
    this.openSocket(GATEWAY_URL);
  }

  async disconnect(): Promise<void> {
    this.destroyed = true;
    this.drops.stop();
    this.clearHeartbeat();

    // Drain concurrency queue so pending waiters resolve and don't block shutdown
    for (const resolve of this.concurrency.queue) {
      resolve();
    }
    this.concurrency.queue.length = 0;

    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'graceful shutdown');
      }
      this.ws = null;
    }
    this.state.status = 'idle';
  }

  assignChannels(channels: Set<string>): void {
    this.state.assignedChannels = channels;
  }

  // ---- socket lifecycle ----

  private openSocket(url: string): void {
    if (this.destroyed) return;

    this.clearHeartbeat();
    this.heartbeatAcked = true;

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      this.log.info({ tokenIndex: this.tokenIndex }, 'gateway socket opened');
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const payload = JSON.parse(raw.toString()) as GatewayPayload;
        this.handlePayload(payload);
      } catch (err: unknown) {
        this.log.error({ tokenIndex: this.tokenIndex, err }, 'failed to parse gateway payload');
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      this.log.warn({ tokenIndex: this.tokenIndex, code, reason: reason.toString() }, 'gateway socket closed');
      this.clearHeartbeat();
      this.handleClose(code);
    });

    ws.on('error', (err: Error) => {
      this.log.error({ tokenIndex: this.tokenIndex, err: err.message }, 'gateway socket error');
    });
  }

  private handlePayload(payload: GatewayPayload): void {
    // Track sequence number
    if (payload.s !== null) {
      this.state.lastSeq = payload.s;
    }

    switch (payload.op) {
      case 10: // HELLO
        this.handleHello(payload.d);
        break;
      case 11: // HEARTBEAT ACK
        this.heartbeatAcked = true;
        break;
      case 1: // HEARTBEAT request from server
        this.sendHeartbeat();
        break;
      case 7: // RECONNECT
        this.log.info({ tokenIndex: this.tokenIndex }, 'server requested reconnect');
        this.closeAndResume();
        break;
      case 9: // INVALID SESSION
        this.handleInvalidSession(payload.d);
        break;
      case 0: // DISPATCH
        this.handleDispatch(payload.t, payload.d);
        break;
      default:
        break;
    }
  }

  // ---- opcode handlers ----

  private handleHello(d: unknown): void {
    if (!isHelloData(d)) {
      this.log.error({ tokenIndex: this.tokenIndex }, 'invalid HELLO payload');
      return;
    }

    const interval = d.heartbeat_interval;
    this.startHeartbeat(interval);

    // If we have a session, resume; otherwise identify
    if (this.state.sessionId && this.state.lastSeq !== null) {
      this.sendResume();
    } else {
      this.sendIdentify();
    }
  }

  private handleInvalidSession(d: unknown): void {
    const resumable = d === true;
    this.log.warn({ tokenIndex: this.tokenIndex, resumable }, 'received INVALID SESSION');

    if (resumable) {
      this.closeAndResume();
    } else {
      // Clear session state, wait random 1-5s, fresh identify
      this.state.sessionId = null;
      this.state.lastSeq = null;
      this.state.resumeUrl = null;
      const delay = randomBetween(1000, 5000);
      void this.reconnectAfter(delay, false);
    }
  }

  private handleDispatch(eventName: string | null, d: unknown): void {
    if (!eventName) return;

    switch (eventName) {
      case 'READY':
        this.handleReady(d);
        break;
      case 'RESUMED':
        this.log.info({ tokenIndex: this.tokenIndex }, 'session resumed');
        this.state.status = 'connected';
        this.state.errorCount = 0;
        this.state.connectedAt = Date.now();
        break;
      case 'MESSAGE_CREATE':
        void this.handleMessageCreate(d);
        break;
      default:
        break;
    }
  }

  private handleReady(d: unknown): void {
    if (!isReadyData(d)) {
      this.log.error({ tokenIndex: this.tokenIndex }, 'invalid READY payload');
      return;
    }

    this.state.sessionId = d.session_id;
    this.state.resumeUrl = d.resume_gateway_url;
    this.state.status = 'connected';
    this.state.errorCount = 0;
    this.state.connectedAt = Date.now();
    this.log.info({ tokenIndex: this.tokenIndex }, 'gateway session ready');
  }

  // ---- message handling ----

  private async handleMessageCreate(d: unknown): Promise<void> {
    if (this.destroyed) return;
    if (!isMessageCreateData(d)) return;

    // Filter: only assigned channels
    if (!this.state.assignedChannels.has(d.channel_id)) return;

    // Skip bots
    if (d.author.bot) return;

    // Only DEFAULT (0) and REPLY (19)
    if (d.type !== 0 && d.type !== 19) return;

    // Build content
    const parts: string[] = [];

    // Reply context
    if (d.referenced_message?.content) {
      const truncated = d.referenced_message.content.slice(0, 200);
      parts.push(`> ${truncated}`);
    }

    // Main content
    if (d.content) {
      parts.push(d.content);
    }

    // Embed descriptions
    if (d.embeds && d.embeds.length > 0) {
      for (const embed of d.embeds) {
        if (embed.description) {
          parts.push(embed.description);
        }
      }
    }

    const content = parts.join('\n');
    if (!content) return;

    const attachments = d.attachments ?? [];
    const validAttachments = attachments.filter((a) => isValidDiscordUrl(a.url));
    const attachmentUrls = validAttachments.map((a) => a.url);
    const imageUrls = validAttachments.filter(isImageAttachment).map((a) => a.url);

    let ts = new Date(d.timestamp).getTime();
    if (Number.isNaN(ts)) {
      this.log.warn({ messageId: d.id }, 'invalid timestamp, using current time');
      ts = Date.now();
    }

    const rawItem: RawItem = {
      id: ulid(),
      source: 'discord',
      sourceId: d.channel_id,
      author: d.author.username,
      content,
      timestamp: ts,
      engagement: 0,
      attachments: attachmentUrls.length > 0 ? attachmentUrls : undefined,
      metadata: {
        guildId: d.guild_id ?? null,
        messageId: d.id,
        imageUrls,
      },
    };

    try {
      await withConcurrencyLimit(this.concurrency, () => this.onMessage(rawItem));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('message queue full')) {
        this.drops.record(d.channel_id);
        this.log.warn(
          { tokenIndex: this.tokenIndex, messageId: d.id, channelId: d.channel_id },
          'message dropped due to queue overflow',
        );
      } else {
        this.log.error({ tokenIndex: this.tokenIndex, messageId: d.id, err }, 'onMessage callback failed');
      }
    }
  }

  // ---- heartbeat ----

  private startHeartbeat(intervalMs: number): void {
    this.clearHeartbeat();
    this.heartbeatAcked = true;

    // First beat after jitter
    const jitter = Math.floor(intervalMs * Math.random());
    this.heartbeatJitterTimer = setTimeout(() => {
      this.heartbeatJitterTimer = null;
      if (this.destroyed) return;
      this.sendHeartbeat();

      this.heartbeatTimer = setInterval(() => {
        if (!this.heartbeatAcked) {
          this.log.warn({ tokenIndex: this.tokenIndex }, 'heartbeat ACK missed — zombie connection');
          this.closeAndResume();
          return;
        }
        this.heartbeatAcked = false;
        this.sendHeartbeat();
      }, intervalMs);
    }, jitter);
  }

  private sendHeartbeat(): void {
    this.send({ op: 1, d: this.state.lastSeq });
    this.heartbeatAcked = false;
  }

  private clearHeartbeat(): void {
    if (this.heartbeatJitterTimer) {
      clearTimeout(this.heartbeatJitterTimer);
      this.heartbeatJitterTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ---- identify / resume ----

  private sendIdentify(): void {
    this.log.info({ tokenIndex: this.tokenIndex }, 'sending IDENTIFY');
    this.send({
      op: 2,
      d: {
        token: this.token,
        capabilities: 16381,
        properties: IDENTIFY_PROPERTIES,
        presence: { status: 'online', since: 0, activities: [], afk: false },
        compress: false,
        client_state: {
          guild_versions: {},
          highest_last_message_id: '0',
          read_state_version: 0,
          user_guild_settings_version: -1,
          user_settings_version: -1,
          private_channels_version: '0',
          api_code_version: 0,
        },
      },
    });
  }

  private sendResume(): void {
    this.log.info({ tokenIndex: this.tokenIndex }, 'sending RESUME');
    this.send({
      op: 6,
      d: {
        token: this.token,
        session_id: this.state.sessionId,
        seq: this.state.lastSeq,
      },
    });
  }

  // ---- reconnection ----

  /** Returns true if the circuit breaker has tripped and the token is now disabled. */
  private checkCircuitBreaker(): boolean {
    if (this.state.errorCount >= MAX_CONSECUTIVE_ERRORS) {
      this.log.error(
        { tokenIndex: this.tokenIndex, errorCount: this.state.errorCount },
        'too many consecutive errors — disabling token',
      );
      this.state.status = 'disabled';
      this.onDeath(this.tokenIndex);
      return true;
    }
    return false;
  }

  private handleClose(code: number): void {
    if (this.destroyed) return;

    // Only count non-resumable close codes as errors toward the circuit breaker.
    // Resumable codes (4000-4003, 4005, 4009, 1001, 1006, undefined) are normal
    // reconnect scenarios and should not inflate the failure counter.
    if (!RESUMABLE_CLOSE_CODES.has(code)) {
      this.state.errorCount += 1;
    }

    if (this.checkCircuitBreaker()) return;

    if (FATAL_CLOSE_CODES.has(code)) {
      this.log.error({ tokenIndex: this.tokenIndex, code }, 'fatal close code — disabling token');
      this.state.status = 'disabled';
      this.state.sessionId = null;
      this.state.lastSeq = null;
      this.state.resumeUrl = null;
      this.onDeath(this.tokenIndex);
      return;
    }

    if (RESUMABLE_CLOSE_CODES.has(code)) {
      void this.resumeWithBackoff();
      return;
    }

    if (NON_RESUMABLE_CLOSE_CODES.has(code)) {
      this.state.sessionId = null;
      this.state.lastSeq = null;
      this.state.resumeUrl = null;
      void this.reconnectAfter(backoffMs(this.reconnectAttempt), false);
      return;
    }

    // Unknown code — try resume
    void this.resumeWithBackoff();
  }

  private closeAndResume(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(4000, 'reconnecting');
      }
      this.ws = null;
    }
    this.clearHeartbeat();

    // Count toward circuit breaker — repeated zombie connections must eventually trip it
    this.state.errorCount += 1;
    if (this.checkCircuitBreaker()) return;

    void this.resumeWithBackoff();
  }

  private async resumeWithBackoff(): Promise<void> {
    if (this.destroyed) return;
    this.state.status = 'backoff';

    // Only reset backoff if the connection was stable for at least 30s
    const STABLE_THRESHOLD_MS = 30_000;
    if (this.state.connectedAt !== null && Date.now() - this.state.connectedAt > STABLE_THRESHOLD_MS) {
      this.reconnectAttempt = 0;
    }

    this.reconnectAttempt += 1;
    const delay = backoffMs(this.reconnectAttempt);
    this.log.info({ tokenIndex: this.tokenIndex, delay, attempt: this.reconnectAttempt }, 'resuming after backoff');
    await sleep(delay);
    if (this.destroyed) return;
    const url = this.state.resumeUrl ?? GATEWAY_URL;
    this.state.status = 'connecting';
    this.openSocket(url);
  }

  private async reconnectAfter(delay: number, _resume: boolean): Promise<void> {
    if (this.destroyed) return;
    this.state.status = 'backoff';
    this.reconnectAttempt += 1;

    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'reconnecting fresh');
      }
      this.ws = null;
    }
    this.clearHeartbeat();

    this.log.info(
      { tokenIndex: this.tokenIndex, delay, attempt: this.reconnectAttempt },
      'reconnecting with fresh identify after delay',
    );
    await sleep(delay);
    if (this.destroyed) return;
    this.state.status = 'connecting';
    this.openSocket(GATEWAY_URL);
  }

  // ---- transport ----

  private send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
}

// ---------------------------------------------------------------------------
// Channel distribution
// ---------------------------------------------------------------------------

function partitionChannels(channels: string[], activeTokens: TokenConnection[]): void {
  if (activeTokens.length === 0) return;

  // Clear existing assignments
  for (const conn of activeTokens) {
    conn.assignChannels(new Set());
  }

  // Round-robin
  for (let i = 0; i < channels.length; i++) {
    const conn = activeTokens[i % activeTokens.length]!;
    conn.state.assignedChannels.add(channels[i]!);
  }
}

// ---------------------------------------------------------------------------
// Public adapter factory
// ---------------------------------------------------------------------------

export function createDiscordAdapter(
  config: Config,
  pool: Pool,
  log: Logger,
  onMessage: (item: RawItem) => Promise<void>,
): {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  getTokenStates: () => TokenState[];
  reconnect: (newTokens: string[]) => Promise<void>;
} {
  const connections: TokenConnection[] = [];

  function getActiveConnections(): TokenConnection[] {
    return connections.filter((c) => c.state.status !== 'disabled');
  }

  async function reassignChannels(): Promise<void> {
    const channels = await getDiscordChannels(pool);
    partitionChannels(channels, getActiveConnections());
  }

  async function handleTokenDeath(index: number): Promise<void> {
    log.error({ tokenIndex: index }, 'token permanently disabled — reassigning channels');
    try {
      await reassignChannels();
    } catch (err: unknown) {
      log.error({ err, tokenIndex: index }, 'failed to reassign channels after token death');
    }
  }

  // Create connection objects for each token
  for (let i = 0; i < config.discordTokens.length; i++) {
    const token = config.discordTokens[i]!;
    connections.push(new TokenConnection(i, token, log, onMessage, handleTokenDeath, pool));
  }

  async function connect(): Promise<void> {
    if (connections.length === 0) {
      log.warn('no discord tokens configured — skipping gateway connect');
      return;
    }

    // Assign channels before connecting
    await reassignChannels();

    // Connect sequentially with 5s gaps
    for (let i = 0; i < connections.length; i++) {
      await connections[i]!.connect();
      if (i < connections.length - 1) {
        await sleep(5000);
      }
    }
  }

  async function disconnect(): Promise<void> {
    await Promise.all(connections.map((c) => c.disconnect()));
  }

  function getTokenStates(): TokenState[] {
    return connections.map((c) => ({ ...c.state }));
  }

  async function reconnect(newTokens: string[]): Promise<void> {
    // 1. Disconnect all existing connections
    await disconnect();

    // 2. Clear the connections array
    connections.length = 0;

    // 3. Create new connections for the new tokens
    for (let i = 0; i < newTokens.length; i++) {
      const token = newTokens[i]!;
      connections.push(new TokenConnection(i, token, log, onMessage, handleTokenDeath, pool));
    }

    // 4. Connect with the new tokens
    await connect();

    log.info({ tokenCount: newTokens.length }, 'discord adapter reconnected with updated tokens');
  }

  return { connect, disconnect, getTokenStates, reconnect };
}
