import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';
import { ulid } from 'ulid';

export interface Config {
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  googleApiKey: string | null;
  geminiApiKey: string | null;
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

function validateModelId(id: string, name: string): void {
  if (!/^[a-zA-Z0-9][\w.\-/:]{2,100}$/.test(id)) {
    throw new Error(
      `Invalid model ID for ${name}: "${id}" — must be 3-101 chars, alphanumeric/hyphens/dots/underscores/slashes/colons`
    );
  }
}

export function loadConfig(): Config {
  dotenv.config();

  const anthropicApiKey = process.env['ANTHROPIC_API_KEY'] || null;
  const openaiApiKey = process.env['OPENAI_API_KEY'] || null;
  const googleApiKey = process.env['GOOGLE_API_KEY'] || null;
  const geminiApiKey = process.env['GEMINI_API_KEY'] || null;
  const databaseUrl = requireEnv('DATABASE_URL');

  // At least one LLM provider is required (API key or OAuth credentials)
  const hasCodexOAuth = existsSync('.oauth-codex.json');
  if (!anthropicApiKey && !openaiApiKey && !googleApiKey && !hasCodexOAuth) {
    throw new Error(
      'At least one LLM provider is required: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, or .oauth-codex.json'
    );
  }

  if (!geminiApiKey && !googleApiKey) {
    console.warn(
      'WARNING: Neither GEMINI_API_KEY nor GOOGLE_API_KEY set — embeddings will be disabled'
    );
  }

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
    console.error('╔══════════════════════════════════════════════════════════════╗');
    console.error('║ WARNING: API_KEY not set — auto-generated ephemeral key     ║');
    console.error('║ Sessions will be lost on restart. Set API_KEY in .env       ║');
    console.error(`║ Generated: ${apiKey.slice(0, 11)}... (set API_KEY in .env)${' '.repeat(14)}║`);
    console.error('╚══════════════════════════════════════════════════════════════╝');
  }

  let sessionSecret = process.env['SESSION_SECRET'] || null;
  if (!sessionSecret) {
    sessionSecret = crypto.randomBytes(32).toString('hex');
    console.error('╔══════════════════════════════════════════════════════════════╗');
    console.error('║ WARNING: SESSION_SECRET not set — auto-generated ephemeral  ║');
    console.error('║ All sessions will be lost on restart. Set in .env           ║');
    console.error('╚══════════════════════════════════════════════════════════════╝');
  }

  const rawPort = process.env['PORT'];
  const port = rawPort ? Number(rawPort) : 3000;
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a valid integer (1-65535), got: ${rawPort}`);
  }
  const dataDir = process.env['DATA_DIR'] || './data';
  let publicUrl: string | null = null;
  const rawPublicUrl = process.env['PUBLIC_URL'] || null;
  if (rawPublicUrl) {
    try {
      const parsed = new URL(rawPublicUrl);
      publicUrl = parsed.origin + parsed.pathname.replace(/\/+$/, '');
    } catch {
      throw new Error(`PUBLIC_URL must be a valid URL, got: ${rawPublicUrl}`);
    }
  }
  let alertWebhookUrl: string | null = null;
  const rawAlertWebhookUrl = process.env['ALERT_WEBHOOK_URL'] || null;
  if (rawAlertWebhookUrl) {
    try {
      const parsed = new URL(rawAlertWebhookUrl);
      alertWebhookUrl = parsed.origin + parsed.pathname.replace(/\/+$/, '');
    } catch {
      console.warn(
        `WARNING: ALERT_WEBHOOK_URL is not a valid URL ("${rawAlertWebhookUrl}") — alerts disabled`
      );
    }
  }

  const models = {
    haiku: process.env['MODEL_HAIKU'] || 'claude-haiku-4-5-20251001',
    sonnet: process.env['MODEL_SONNET'] || 'claude-sonnet-4-6-20250514',
  };
  validateModelId(models.haiku, 'MODEL_HAIKU');
  validateModelId(models.sonnet, 'MODEL_SONNET');

  const secrets: string[] = [
    anthropicApiKey,
    openaiApiKey,
    googleApiKey,
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
    openaiApiKey,
    googleApiKey,
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
