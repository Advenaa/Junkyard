import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { ulid } from 'ulid';

export interface Config {
  anthropicApiKey: string;
  geminiApiKey: string;
  databaseUrl: string;
  discordClientId: string | null;
  discordClientSecret: string | null;
  adminUserIds: string[];
  discordTokens: string[];
  twitterApiKey: string | null;
  apiKey: string;
  sessionSecret: string;
  port: number;
  dataDir: string;
  publicUrl: string | null;
  alertWebhookUrl: string | null;
  models: {
    haiku: string;
    sonnet: string;
  };
  secrets: string[];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function commaSplit(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function loadConfig(): Config {
  dotenv.config();

  const anthropicApiKey = requireEnv('ANTHROPIC_API_KEY');
  const geminiApiKey = requireEnv('GEMINI_API_KEY');
  const databaseUrl = requireEnv('DATABASE_URL');

  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    throw new Error(
      'DATABASE_URL must start with postgres:// or postgresql://'
    );
  }

  const discordClientId = process.env['DISCORD_CLIENT_ID'] || null;
  const discordClientSecret = process.env['DISCORD_CLIENT_SECRET'] || null;

  if (!discordClientId) {
    console.warn(
      'WARNING: DISCORD_CLIENT_ID is missing — Discord auth unavailable'
    );
  }
  if (!discordClientSecret) {
    console.warn(
      'WARNING: DISCORD_CLIENT_SECRET is missing — Discord auth unavailable'
    );
  }

  const adminUserIds = commaSplit(process.env['ADMIN_USER_IDS']);
  const discordTokens = commaSplit(process.env['DISCORD_TOKENS']);
  const twitterApiKey = process.env['TWITTERAPI_KEY'] || null;

  let apiKey = process.env['API_KEY'] || null;
  if (!apiKey) {
    apiKey = `pk_${ulid()}`;
    console.warn('WARNING: API_KEY not set — auto-generated (set API_KEY in .env for persistence)');
  }

  let sessionSecret = process.env['SESSION_SECRET'] || null;
  if (!sessionSecret) {
    sessionSecret = crypto.randomBytes(32).toString('hex');
    console.warn('WARNING: SESSION_SECRET not set — auto-generated (set SESSION_SECRET in .env for persistence)');
  }

  const rawPort = process.env['PORT'];
  const port = rawPort ? Number(rawPort) : 3000;
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a valid integer (1-65535), got: ${rawPort}`);
  }
  const dataDir = process.env['DATA_DIR'] || './data';
  const publicUrl = process.env['PUBLIC_URL'] || null;
  const alertWebhookUrl = process.env['ALERT_WEBHOOK_URL'] || null;

  const models = {
    haiku: process.env['MODEL_HAIKU'] || 'claude-haiku-4-5-20251001',
    sonnet: process.env['MODEL_SONNET'] || 'claude-sonnet-4-6-20250514',
  };

  const secrets: string[] = [
    anthropicApiKey,
    geminiApiKey,
    databaseUrl,
    discordClientSecret,
    twitterApiKey,
    apiKey,
    sessionSecret,
    alertWebhookUrl,
    ...discordTokens,
  ].filter((v): v is string => v !== null);

  return Object.freeze({
    anthropicApiKey,
    geminiApiKey,
    databaseUrl,
    discordClientId,
    discordClientSecret,
    adminUserIds,
    discordTokens,
    twitterApiKey,
    apiKey,
    sessionSecret,
    port,
    dataDir,
    publicUrl,
    alertWebhookUrl,
    models,
    secrets,
  });
}
