import pino from 'pino';

export type Logger = pino.Logger;

function redactString(str: string, secrets: string[]): string {
  let result = str;
  for (const secret of secrets) {
    result = result.replaceAll(secret, '[REDACTED]');
  }
  return result;
}

function redactSecrets(obj: unknown, secrets: string[]): unknown {
  if (typeof obj === 'string') {
    return redactString(obj, secrets);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSecrets(item, secrets));
  }

  if (obj instanceof Error) {
    const redacted: Record<string, unknown> = {
      message: redactString(obj.message, secrets),
      stack: obj.stack ? redactString(obj.stack, secrets) : undefined,
      type: obj.constructor.name,
    };
    for (const [key, value] of Object.entries(obj)) {
      redacted[key] = redactSecrets(value, secrets);
    }
    return redacted;
  }

  if (obj !== null && typeof obj === 'object') {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      redacted[key] = redactSecrets(value, secrets);
    }
    return redacted;
  }

  return obj;
}

export function createLogger(secrets: string[]): pino.Logger {
  const filtered = secrets.filter((s) => s.length >= 4);

  const transport: pino.TransportSingleOptions | undefined =
    process.env['NODE_ENV'] !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined;

  return pino({
    name: 'podders',
    level: process.env['LOG_LEVEL'] || 'info',
    formatters: {
      log(bindings: Record<string, unknown>) {
        if (filtered.length === 0) return bindings;
        return redactSecrets(bindings, filtered) as Record<string, unknown>;
      },
    },
    hooks: {
      logMethod(inputArgs, method) {
        if (filtered.length === 0) return method.apply(this, inputArgs);
        const redacted = inputArgs.map((arg) => {
          if (typeof arg === 'string') return redactString(arg, filtered);
          return arg;
        });
        return method.apply(this, redacted as Parameters<typeof method>);
      },
    },
    serializers: {
      err(err: Error) {
        const serialized = pino.stdSerializers.err(err);
        if (!serialized || filtered.length === 0) return serialized;
        return redactSecrets(serialized, filtered) as Record<string, unknown>;
      },
    },
    ...(transport ? { transport } : {}),
  });
}
