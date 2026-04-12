import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from './db/connection.js';
import { addBookmark, getBookmarkedReportIds, removeBookmark } from './db/queries.js';

type RoutePreHandler = (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;

interface BookmarkRouteDeps {
  app: FastifyInstance;
  authPreHandler: RoutePreHandler;
  pool: Pool;
}

export function registerBookmarkRoutes({ app, authPreHandler, pool }: BookmarkRouteDeps): void {
  app.get('/api/v1/bookmarks', { preHandler: [authPreHandler] }, async (request) => {
    const userId = request.user!.discordId;
    const reportIds = await getBookmarkedReportIds(pool, userId);
    return { reportIds };
  });

  app.post('/api/v1/bookmarks', { preHandler: [authPreHandler] }, async (request, reply) => {
    const { reportId } = request.body as { reportId: string };
    if (!reportId || typeof reportId !== 'string') {
      return reply.code(400).send({ error: 'reportId is required' });
    }
    const userId = request.user!.discordId;
    await addBookmark(pool, userId, reportId);
    return reply.code(201).send({ ok: true });
  });

  app.delete('/api/v1/bookmarks/:reportId', { preHandler: [authPreHandler] }, async (request, reply) => {
    const { reportId } = request.params as { reportId: string };
    const userId = request.user!.discordId;
    const deleted = await removeBookmark(pool, userId, reportId);
    if (!deleted) {
      return reply.code(404).send({ error: 'Bookmark not found' });
    }
    return { ok: true };
  });
}
