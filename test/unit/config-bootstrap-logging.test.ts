import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config.js';

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe('config bootstrap logging', () => {
  it('does not print the generated API key value to stderr', () => {
    const envSnapshot = { ...process.env };
    const originalError = console.error;
    const originalWarn = console.warn;
    const errors: string[] = [];
    const warnings: string[] = [];

    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    };
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };

    try {
      process.env['DATABASE_URL'] = 'postgresql://podders:test@localhost:5432/podders';
      process.env['OPENAI_API_KEY'] = 'openai-test-key';
      process.env['GEMINI_API_KEY'] = 'gemini-test-key';
      process.env['DISCORD_CLIENT_ID'] = 'discord-client-id';
      process.env['DISCORD_CLIENT_SECRET'] = 'discord-client-secret';
      process.env['SESSION_SECRET'] = 'session-secret-for-test';
      delete process.env['API_KEY'];
      delete process.env['ALERT_WEBHOOK_URL'];

      const config = loadConfig();
      const stderr = errors.join('\n');

      assert.ok(config.apiKey.startsWith('pk_'), 'loadConfig should still generate an API key');
      assert.match(stderr, /API_KEY not set/, 'warning should still explain why the key was generated');
      assert.ok(!stderr.includes(config.apiKey), 'stderr must not include the generated API key');
      assert.ok(
        !stderr.includes(config.apiKey.slice(0, 11)),
        'stderr must not include any generated API key prefix preview',
      );
      assert.equal(warnings.length, 0, 'test setup should avoid unrelated console warnings');
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
      restoreEnv(envSnapshot);
    }
  });

  it('does not echo invalid ALERT_WEBHOOK_URL values in warnings', () => {
    const envSnapshot = { ...process.env };
    const originalWarn = console.warn;
    const warnings: string[] = [];
    const rawSecretLikeWebhook = 'discord-webhook-secret-token';

    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };

    try {
      process.env['DATABASE_URL'] = 'postgresql://podders:test@localhost:5432/podders';
      process.env['OPENAI_API_KEY'] = 'openai-test-key';
      process.env['GEMINI_API_KEY'] = 'gemini-test-key';
      process.env['DISCORD_CLIENT_ID'] = 'discord-client-id';
      process.env['DISCORD_CLIENT_SECRET'] = 'discord-client-secret';
      process.env['SESSION_SECRET'] = 'session-secret-for-test';
      process.env['API_KEY'] = 'configured-api-key';
      process.env['ALERT_WEBHOOK_URL'] = rawSecretLikeWebhook;

      const config = loadConfig();
      const warningOutput = warnings.join('\n');

      assert.equal(config.alertWebhookUrl, null, 'invalid webhook URLs should be ignored');
      assert.match(
        warningOutput,
        /ALERT_WEBHOOK_URL is not a valid URL — alerts disabled/,
        'warning should still explain why alerts were disabled',
      );
      assert.ok(!warningOutput.includes(rawSecretLikeWebhook), 'warning output must not echo the raw webhook secret');
    } finally {
      console.warn = originalWarn;
      restoreEnv(envSnapshot);
    }
  });
});
