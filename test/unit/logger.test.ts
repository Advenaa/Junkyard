import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLogger, type Logger } from '../../src/logger.js';

interface SerializedError {
  message?: string;
  stack?: string;
  type?: string;
  [key: string]: unknown;
}

interface CapturedLogEntry {
  msg?: string;
  err?: SerializedError;
  [key: string]: unknown;
}

async function captureLogEntry(secrets: string[], emit: (logger: Logger) => void): Promise<CapturedLogEntry> {
  const chunks: string[] = [];
  const originalNodeEnv = process.env['NODE_ENV'];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.env['NODE_ENV'] = 'production';
  process.stdout.write = ((chunk, encoding, callback) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    const done = typeof encoding === 'function' ? encoding : callback;
    done?.();
    return true;
  }) as typeof process.stdout.write;

  try {
    const logger = createLogger(secrets);
    emit(logger);
    await new Promise<void>((resolve) => logger.flush(() => resolve()));
  } finally {
    process.stdout.write = originalWrite;
    if (originalNodeEnv === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = originalNodeEnv;
    }
  }

  const lines = chunks.join('').trim().split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 1);
  return JSON.parse(lines[0]) as CapturedLogEntry;
}

describe('createLogger', () => {
  it('masks API key in log bindings', async () => {
    const secret = 'test-api-key-123';
    const entry = await captureLogEntry([secret], (logger) => {
      logger.info({ apiKey: secret }, 'configured');
    });

    assert.strictEqual(entry['apiKey'], '[REDACTED]');
  });

  it('masks Discord tokens in nested objects', async () => {
    const secret = 'discord-token-here';
    const entry = await captureLogEntry([secret], (logger) => {
      logger.info({ config: { token: secret } }, 'loaded token');
    });

    assert.deepStrictEqual(entry['config'], { token: '[REDACTED]' });
  });

  it('masks webhook URLs', async () => {
    const secret = 'https://discord.com/api/webhooks/123/abcdef';
    const entry = await captureLogEntry([secret], (logger) => {
      logger.info({ webhookUrl: secret }, 'webhook configured');
    });

    assert.strictEqual(entry['webhookUrl'], '[REDACTED]');
  });

  it('masks session cookies', async () => {
    const secret = 'session-cookie-secret';
    const entry = await captureLogEntry([secret], (logger) => {
      logger.info({ cookie: `podders_session=${secret}; Path=/; HttpOnly` }, 'request received');
    });

    assert.strictEqual(entry['cookie'], 'podders_session=[REDACTED]; Path=/; HttpOnly');
  });

  it('preserves non-secret strings', async () => {
    const entry = await captureLogEntry(['top-secret-value'], (logger) => {
      logger.info({ status: 'all clear', message: 'safe text' }, 'healthy');
    });

    assert.strictEqual(entry['status'], 'all clear');
    assert.strictEqual(entry['message'], 'safe text');
    assert.strictEqual(entry.msg, 'healthy');
  });

  it('ignores short secrets under four characters', async () => {
    const entry = await captureLogEntry(['abc'], (logger) => {
      logger.info({ token: 'abc' }, 'value abc remains visible');
    });

    assert.strictEqual(entry['token'], 'abc');
    assert.strictEqual(entry.msg, 'value abc remains visible');
  });

  it('masks secrets in string message arguments', async () => {
    const secret = 'message-secret-789';
    const entry = await captureLogEntry([secret], (logger) => {
      logger.info(`processing ${secret}`);
    });

    assert.strictEqual(entry.msg, 'processing [REDACTED]');
  });

  it('masks secrets in Error serialization', async () => {
    const secret = 'error-secret-123';
    const err = new Error(`operation failed for ${secret}`);
    const entry = await captureLogEntry([secret], (logger) => {
      logger.error({ err }, 'request failed');
    });

    assert.strictEqual(entry.err?.message, 'operation failed for [REDACTED]');
  });

  it('masks secrets in Error stack traces', async () => {
    const secret = 'stack-secret-987';
    const err = new Error('stack failed');
    err.stack = `Error: stack failed with ${secret}\n    at ${secret}`;

    const entry = await captureLogEntry([secret], (logger) => {
      logger.error({ err }, 'request failed');
    });

    assert.ok(entry.err?.stack?.includes('[REDACTED]'));
    assert.ok(!entry.err?.stack?.includes(secret));
  });

  it('recursively masks deeply nested objects', async () => {
    const secret = 'deep-secret-456';
    const entry = await captureLogEntry([secret], (logger) => {
      logger.info({ level1: { level2: { level3: { token: secret } } } }, 'deep structure');
    });

    assert.deepStrictEqual(entry['level1'], {
      level2: {
        level3: {
          token: '[REDACTED]',
        },
      },
    });
  });

  it('masks secrets in arrays', async () => {
    const secret = 'array-secret-654';
    const entry = await captureLogEntry([secret], (logger) => {
      logger.info({ values: ['alpha', secret, `prefix ${secret}`] }, 'array logged');
    });

    assert.deepStrictEqual(entry['values'], ['alpha', '[REDACTED]', 'prefix [REDACTED]']);
  });
});
