import { getAppConfig, setAppConfig } from '../db/queries.js';
import { fetchValidated, validateUrl } from '../url-validator.js';
import type { AdminRouteDeps } from '../server-admin-routes.js';

export function registerConfigRoutes({
  app,
  authPreHandler,
  config,
  log,
  onConfigChange,
  pool,
  requireAdmin,
}: AdminRouteDeps): void {
  app.get('/api/v1/config', { preHandler: [authPreHandler] }, async (request) => {
    const [digestTime, timezone, webhookUrl] = await Promise.all([
      getAppConfig(pool, 'digest_time'),
      getAppConfig(pool, 'timezone'),
      getAppConfig(pool, 'webhook_url'),
    ]);
    const apiKey = request.user?.role === 'admin' ? config.apiKey : undefined;
    return { digestTime, timezone, webhookUrl, apiKey };
  });

  app.patch(
    '/api/v1/config',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        body: {
          type: 'object',
          properties: {
            digest_time: { type: 'string' },
            digestTime: { type: 'string' },
            timezone: { type: 'string' },
            webhook_url: { type: 'string' },
            webhookUrl: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as Record<string, string>;
      if ('digestTime' in body) {
        body['digest_time'] = body['digestTime'];
        delete body['digestTime'];
      }
      if ('webhookUrl' in body) {
        body['webhook_url'] = body['webhookUrl'];
        delete body['webhookUrl'];
      }
      const allowedKeys = ['digest_time', 'timezone', 'webhook_url'];

      if ('digest_time' in body && body['digest_time']) {
        const match = body['digest_time'].match(/^(\d{1,2}):(\d{2})$/);
        if (!match) {
          return reply.code(400).send({ error: 'Invalid digest_time format, expected HH:MM' });
        }
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
          return reply.code(400).send({ error: 'digest_time out of range (hour 0-23, minute 0-59)' });
        }
      }

      if ('timezone' in body && body['timezone']) {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: body['timezone'] });
        } catch {
          return reply.code(400).send({ error: `Invalid timezone: ${body['timezone']}` });
        }
      }

      if ('webhook_url' in body && body['webhook_url']) {
        const validation = await validateUrl(body['webhook_url']);
        if (!validation.valid) {
          return reply.code(400).send({ error: `Invalid webhook URL: ${validation.reason}` });
        }
      }

      const updates: Array<Promise<void>> = [];
      for (const key of allowedKeys) {
        if (key in body) {
          updates.push(setAppConfig(pool, key, body[key]));
        }
      }
      await Promise.all(updates);

      if (onConfigChange && ('digest_time' in body || 'timezone' in body)) {
        try {
          await onConfigChange();
        } catch (err) {
          log.error({ err }, 'config change callback failed');
        }
      }

      const [digestTime, timezone, webhookUrl] = await Promise.all([
        getAppConfig(pool, 'digest_time'),
        getAppConfig(pool, 'timezone'),
        getAppConfig(pool, 'webhook_url'),
      ]);
      return { digestTime, timezone, webhookUrl };
    },
  );

  app.post(
    '/api/v1/config/test-webhook',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        body: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', minLength: 1, maxLength: 2048 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { url } = request.body as { url: string };
      const validation = await validateUrl(url);
      if (!validation.valid || !validation.resolvedIp) {
        return reply.code(400).send({ error: `Invalid webhook URL: ${validation.reason ?? 'DNS resolution failed'}` });
      }
      try {
        const payload = JSON.stringify({
          embeds: [
            {
              title: 'Podders Test Webhook',
              description: 'If you can see this, your webhook is configured correctly.',
              color: 0x5b8def,
              timestamp: new Date().toISOString(),
              footer: { text: 'podders — test delivery' },
            },
          ],
          allowed_mentions: { parse: [] },
        });
        const { response } = await fetchValidated(
          url,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            signal: AbortSignal.timeout(15_000),
          },
          validation,
        );
        if (!response) {
          return reply
            .code(400)
            .send({ error: `Invalid webhook URL: ${validation.reason ?? 'DNS resolution failed'}` });
        }
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          return reply.code(400).send({ error: `Webhook returned ${response.status}`, detail: text.slice(0, 200) });
        }
        await response.text().catch(() => '');
        return { success: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return reply.code(400).send({ error: `Webhook delivery failed: ${message}` });
      }
    },
  );
}
