import {
  deleteDiscordToken,
  insertDiscordToken,
  updateDiscordTokenLabel,
  updateDiscordTokenProxy,
  updateDiscordTokenStatus,
} from '../db/queries.js';
import { encryptSecret, getEncryptionKey } from '../crypto/token-encrypt.js';
import { maskProxyUrl, normalizeProxyUrl } from '../discord-tokens.js';
import type { AdminRouteDeps } from '../server-admin-routes.js';
import { type DiscordTokenHealthState, getManagedDiscordTokenViews, toCamelCase } from '../server-route-helpers.js';

export function registerDiscordTokenRoutes({
  app,
  authPreHandler,
  discordRest,
  getTokenHealth,
  log,
  onTokensChanged,
  pool,
  requireAdmin,
}: AdminRouteDeps): void {
  app.get('/api/v1/discord/guilds', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const guilds = await discordRest.getGuilds();
    return { guilds: guilds.map((guild) => toCamelCase(guild as unknown as Record<string, unknown>)) };
  });

  app.get<{ Params: { guildId: string } }>(
    '/api/v1/discord/guilds/:guildId/channels',
    { preHandler: [authPreHandler, requireAdmin] },
    async (request) => {
      const { guildId } = request.params;
      const channels = await discordRest.getChannels(guildId);
      return { channels: channels.map((channel) => toCamelCase(channel as unknown as Record<string, unknown>)) };
    },
  );

  app.get('/api/v1/discord/tokens', { preHandler: [authPreHandler, requireAdmin] }, async (_request, reply) => {
    const encKey = getEncryptionKey();
    if (!encKey) {
      return reply
        .code(503)
        .send({ error: 'Token encryption not configured — set TOKEN_ENCRYPTION_KEY or SESSION_SECRET' });
    }
    const tokens = (await getManagedDiscordTokenViews(pool, encKey)).map((token) => ({
      id: token.id,
      maskedToken: token.maskedToken,
      label: token.label,
      status: token.status,
      addedAt: token.addedAt,
      lastUsedAt: token.lastUsedAt,
      proxyConfigured: token.proxyConfigured,
      maskedProxy: token.maskedProxy,
    }));
    return { tokens };
  });

  app.post(
    '/api/v1/discord/tokens',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        body: {
          type: 'object',
          required: ['token'],
          properties: {
            token: { type: 'string', minLength: 1, maxLength: 500 },
            label: { type: 'string', maxLength: 100 },
            proxyUrl: { type: 'string', minLength: 1, maxLength: 500 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const encKey = getEncryptionKey();
      if (!encKey) {
        return reply
          .code(503)
          .send({ error: 'Token encryption not configured — set TOKEN_ENCRYPTION_KEY or SESSION_SECRET' });
      }
      const { token, label, proxyUrl } = request.body as { token: string; label?: string; proxyUrl?: string };
      const { ulid } = await import('ulid');
      const id = ulid();
      const encryptedToken = encryptSecret(token, encKey);

      let encryptedProxy: { ciphertext: string; iv: string; authTag: string } | null = null;
      if (proxyUrl) {
        try {
          encryptedProxy = encryptSecret(normalizeProxyUrl(proxyUrl), encKey);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Invalid proxy URL';
          return reply.code(400).send({ error: message });
        }
      }

      await insertDiscordToken(
        pool,
        id,
        encryptedToken.ciphertext,
        encryptedToken.iv,
        encryptedToken.authTag,
        label ?? null,
        Date.now(),
        encryptedProxy,
      );
      if (onTokensChanged)
        onTokensChanged()
          .then((tokens) => discordRest.updateTokens(tokens))
          .catch((err: unknown) => log.error({ err }, 'token reload failed'));
      reply.code(201);
      return {
        id,
        label: label ?? null,
        status: 'active',
        addedAt: Date.now(),
        proxyConfigured: encryptedProxy != null,
        maskedProxy: proxyUrl ? maskProxyUrl(normalizeProxyUrl(proxyUrl)) : null,
      };
    },
  );

  app.delete<{ Params: { tokenId: string } }>(
    '/api/v1/discord/tokens/:tokenId',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        params: {
          type: 'object',
          required: ['tokenId'],
          properties: {
            tokenId: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { tokenId } = request.params;
      const deleted = await deleteDiscordToken(pool, tokenId);
      if (!deleted) {
        return reply.code(404).send({ error: 'Token not found' });
      }
      if (onTokensChanged)
        onTokensChanged()
          .then((tokens) => discordRest.updateTokens(tokens))
          .catch((err: unknown) => log.error({ err }, 'token reload failed'));
      reply.code(204).send();
    },
  );

  app.patch<{ Params: { tokenId: string } }>(
    '/api/v1/discord/tokens/:tokenId',
    {
      preHandler: [authPreHandler, requireAdmin],
      schema: {
        body: {
          type: 'object',
          properties: {
            label: { type: 'string', maxLength: 100 },
            status: { type: 'string', enum: ['active', 'disabled'] },
            proxyUrl: {
              anyOf: [{ type: 'string', minLength: 1, maxLength: 500 }, { type: 'null' }],
            },
          },
          additionalProperties: false,
        },
        params: {
          type: 'object',
          required: ['tokenId'],
          properties: {
            tokenId: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { tokenId } = request.params;
      const body = request.body as { label?: string; status?: string; proxyUrl?: string | null };
      if (body.label != null) {
        const updated = await updateDiscordTokenLabel(pool, tokenId, body.label);
        if (!updated) return reply.code(404).send({ error: 'Token not found' });
      }
      if (body.status != null) {
        const updated = await updateDiscordTokenStatus(pool, tokenId, body.status);
        if (!updated) return reply.code(404).send({ error: 'Token not found' });
      }
      if (Object.prototype.hasOwnProperty.call(body, 'proxyUrl')) {
        const encKey = getEncryptionKey();
        if (!encKey) {
          return reply
            .code(503)
            .send({ error: 'Token encryption not configured — set TOKEN_ENCRYPTION_KEY or SESSION_SECRET' });
        }

        let encryptedProxy: { ciphertext: string; iv: string; authTag: string } | null = null;
        if (body.proxyUrl != null) {
          try {
            encryptedProxy = encryptSecret(normalizeProxyUrl(body.proxyUrl), encKey);
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Invalid proxy URL';
            return reply.code(400).send({ error: message });
          }
        }

        const updated = await updateDiscordTokenProxy(pool, tokenId, encryptedProxy);
        if (!updated) return reply.code(404).send({ error: 'Token not found' });
      }
      if ((body.status != null || Object.prototype.hasOwnProperty.call(body, 'proxyUrl')) && onTokensChanged) {
        onTokensChanged()
          .then((tokens) => discordRest.updateTokens(tokens))
          .catch((err: unknown) => log.error({ err }, 'token reload failed'));
      }
      return { ok: true };
    },
  );

  app.get('/api/v1/discord/tokens/health', { preHandler: [authPreHandler, requireAdmin] }, async () => {
    const encKey = getEncryptionKey();
    const managedTokens = encKey ? await getManagedDiscordTokenViews(pool, encKey) : [];
    const managedById = new Map(managedTokens.map((token) => [token.id, token]));
    const runtimeStates = getTokenHealth ? await getTokenHealth() : [];

    const states: DiscordTokenHealthState[] = runtimeStates.map((state) => {
      const managedMeta = state.tokenId ? managedById.get(state.tokenId) : null;
      return {
        ...state,
        lastSuccessfulPollAt: state.lastSuccessfulPollAt ?? managedMeta?.lastUsedAt ?? null,
        label: managedMeta?.label ?? state.label ?? null,
        maskedToken: managedMeta?.maskedToken ?? state.maskedToken ?? null,
        proxyConfigured: managedMeta?.proxyConfigured ?? state.proxyConfigured ?? false,
        maskedProxy: managedMeta?.maskedProxy ?? state.maskedProxy ?? null,
      };
    });

    for (const managedToken of managedTokens) {
      if (states.some((state) => state.tokenId === managedToken.id)) {
        continue;
      }

      states.push({
        index: states.length,
        status: managedToken.status === 'active' ? 'idle' : 'disabled',
        errorCount: 0,
        lastSuccessfulPollAt: managedToken.lastUsedAt,
        channelCount: 0,
        source: 'db',
        tokenId: managedToken.id,
        label: managedToken.label,
        maskedToken: managedToken.maskedToken,
        proxyConfigured: managedToken.proxyConfigured,
        maskedProxy: managedToken.maskedProxy,
      });
    }

    return { states };
  });
}
