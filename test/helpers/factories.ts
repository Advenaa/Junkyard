import type { FastifyRequest } from 'fastify';

import type { Config } from '../../src/config.js';
import { computeDisabledFeatures } from '../../src/features.js';
import type { SummaryRow } from '../../src/db/queries.js';
import type { ExtractedEntity } from '../../src/knowledge/entities.js';
import type { Logger } from '../../src/logger.js';
import type { EntitySearchSuggestionRow } from '../../src/server-route-helpers.js';
import type { MockLogger, MockPool, MockQueryResult, PgPool } from './mock-types.js';

export interface MockQueryCall {
  sql: string;
  params: unknown[];
}

export interface MockPoolFactoryResult extends PgPool, MockPool {
  calls: MockQueryCall[];
  pool: MockPoolFactoryResult;
}

export interface FakeRequestOptions {
  authorization?: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string | undefined>;
  ip?: string;
  unsignResult?: { valid: boolean; renew?: boolean; value: string | null };
  user?: { discordId: string; username: string; role: string };
  userAgent?: string;
}

export type FakeConfigOverrides = Partial<Omit<Config, 'disabledFeatures' | 'models' | 'secrets'>> & {
  disabledFeatures?: Config['disabledFeatures'];
  models?: Partial<Config['models']>;
  secrets?: string[];
};

export interface EntityRowFixture extends Omit<EntitySearchSuggestionRow, 'last_seen' | 'matched_alias'> {
  first_seen: number;
  last_seen: number;
  type: ExtractedEntity['type'];
}

type QueryHandler = (
  sql: string,
  params?: readonly unknown[],
) => MockQueryResult | Promise<MockQueryResult | undefined> | undefined;

function isTransactionControlSql(sql: string): boolean {
  const normalized = sql.trim().toUpperCase();
  return normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK';
}

function toQueryResult<T extends Record<string, unknown>>(
  result: MockQueryResult | undefined,
): { rowCount: number; rows: T[] } {
  const rows = result?.rows ?? [];
  return {
    rows: rows as unknown as T[],
    rowCount: result?.rowCount ?? rows.length,
  };
}

function collectSecrets(config: Omit<Config, 'disabledFeatures'>): string[] {
  return [
    config.anthropicApiKey,
    config.openaiApiKey,
    config.googleApiKey,
    config.geminiApiKey,
    config.databaseUrl,
    config.discordClientSecret,
    config.twitterApiKey,
    config.coingeckoApiKey,
    config.fredApiKey,
    config.apiKey,
    config.sessionSecret,
    config.alertWebhookUrl,
    ...config.discordTokens,
  ].filter((value): value is string => value !== null && value.length > 0);
}

export function makeMockPool(queryHandler?: QueryHandler): MockPoolFactoryResult {
  const calls: MockQueryCall[] = [];

  const query = async <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<{ rowCount: number; rows: T[] }> => {
    const normalizedParams = [...params];
    calls.push({ sql, params: normalizedParams });

    if (isTransactionControlSql(sql)) {
      return { rows: [], rowCount: 0 };
    }

    const result = await queryHandler?.(sql, normalizedParams);
    if (result !== undefined) {
      return toQueryResult<T>(result);
    }

    return { rows: [], rowCount: 0 };
  };

  const client = {
    query,
    release: () => {},
  };

  const basePool = {
    calls,
    connect: async () => client,
    query,
  };

  const pool = Object.assign(basePool, {
    pool: basePool,
  });

  return pool as unknown as MockPoolFactoryResult;
}

export function makeMockLogger(): Logger & MockLogger {
  const logger = {
    info: (..._args: unknown[]) => {},
    warn: (..._args: unknown[]) => {},
    error: (..._args: unknown[]) => {},
    debug: (..._args: unknown[]) => {},
    fatal: (..._args: unknown[]) => {},
    child: () => logger,
  };

  return logger as unknown as Logger & MockLogger;
}

export function fakeConfig(overrides: FakeConfigOverrides = {}): Config {
  const baseModels: Config['models'] = {
    normalizer: 'openai-codex:gpt-5.4-mini',
    chunk: 'openai-codex:gpt-5.4-mini',
    thinkalot: 'openai-codex:gpt-5.4',
    normalizerFallback: null,
    chunkFallback: null,
    thinkalotFallback: null,
  };

  const baseConfig = {
    anthropicApiKey: null,
    openaiApiKey: 'test-openai-key',
    googleApiKey: null,
    geminiApiKey: null,
    databaseUrl: 'postgresql://podders:test@localhost:5432/podders',
    discordClientId: null,
    discordClientSecret: null,
    adminUserIds: [],
    discordTokens: [],
    twitterApiKey: null,
    coingeckoApiKey: null,
    fredApiKey: null,
    apiKey: 'test-api-key',
    sessionSecret: 'test-session-secret',
    port: 3000,
    dataDir: './data',
    publicUrl: null,
    alertWebhookUrl: null,
    models: baseModels,
  };

  const mergedConfig = {
    ...baseConfig,
    ...overrides,
    models: {
      ...baseModels,
      ...overrides.models,
    },
  };

  const config = {
    ...mergedConfig,
    secrets: overrides.secrets ?? collectSecrets(mergedConfig),
    disabledFeatures: overrides.disabledFeatures ?? computeDisabledFeatures(mergedConfig as unknown as Config),
  };

  return config as Config;
}

export function fakeRequest(overrides: FakeRequestOptions = {}): FastifyRequest {
  const headers = {
    ...overrides.headers,
    authorization: overrides.authorization ?? overrides.headers?.authorization,
    'user-agent': overrides.userAgent ?? overrides.headers?.['user-agent'] ?? 'TestAgent/1.0',
  };

  const request = {
    cookies: overrides.cookies ?? {},
    headers,
    ip: overrides.ip ?? '127.0.0.1',
    unsignCookie: (_raw: string) =>
      overrides.unsignResult ?? {
        renew: false,
        valid: false,
        value: null,
      },
    user: overrides.user,
  };

  return request as unknown as FastifyRequest;
}

export function fakeSummary(overrides: Partial<SummaryRow> = {}): SummaryRow {
  const now = Date.now();

  return {
    id: 'summary-default',
    source: 'discord',
    source_id: 'source-default',
    window_start: now - 60_000,
    window_end: now - 30_000,
    body: JSON.stringify({ summary: 'Default summary body' }),
    sentiment: 0,
    urgency: 'routine',
    item_count: 1,
    created_at: now - 1_000,
    ...overrides,
  };
}

export function fakeEntity(overrides: Partial<EntityRowFixture> = {}): EntityRowFixture {
  const now = Date.now();

  return {
    id: 'ent-default',
    name: 'bitcoin',
    type: 'token',
    status: 'active',
    relevance: 1,
    first_seen: now - 3_600_000,
    last_seen: now,
    ...overrides,
  };
}
