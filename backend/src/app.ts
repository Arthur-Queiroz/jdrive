import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createDatabase, type AppDatabase } from './db/client.js';
import { registerAuthRoutes } from './auth-routes.js';
import { registerFileRoutes } from './file-routes.js';
import { AppError } from './errors.js';
import { storageConfig } from './storage/config.js';

export function buildServer(options: { database?: AppDatabase; logger?: boolean } = {}) {
  const ownedDatabase = options.database ? undefined : createDatabase();
  const database = options.database ?? ownedDatabase!;
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: process.env.NODE_ENV === 'production',
    // Corpo máximo coerente com o limite por arquivo (uploads multipart 1:1).
    bodyLimit: storageConfig.maxFileBytes,
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    return payload;
  });
  app.register(cookie);
  app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) => new AppError(context.statusCode, 'RATE_LIMITED', 'Too many attempts'),
  });
  app.register(multipart, { limits: { fileSize: storageConfig.maxFileBytes, files: 20, fields: 20, parts: 40 } });
  app.get('/health', async () => ({ status: 'ok' }));
  app.register(async (instance) => registerAuthRoutes(instance, database.db));
  app.register(async (instance) => registerFileRoutes(instance, database.db, database.lockPool));

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const frontendDist = path.resolve(moduleDir, '../../frontend/dist');
  if (existsSync(frontendDist)) {
    app.register(staticFiles, { root: frontendDist, prefix: '/', wildcard: false, index: ['index.html'] });
    app.get('/*', async (request, reply) => {
      if (request.url === '/api' || request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
      }
      return reply.type('text/html').sendFile('index.html');
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const statusCode = 404;
    return reply.code(statusCode).send({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    const statusCode = Number((error as { statusCode?: number }).statusCode);
    if (statusCode === 413 || (error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: { code: 'FILE_TOO_LARGE', message: 'File exceeds the configured per-file size limit' } });
    }
    if (statusCode >= 400 && statusCode < 500) {
      const code = statusCode === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'INVALID_REQUEST';
      return reply.code(statusCode).send({ error: { code, message: 'Invalid request' } });
    }
    request.log.error({ err: error }, 'Request failed');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred' } });
  });

  app.addHook('onClose', async () => {
    if (ownedDatabase) await Promise.all([ownedDatabase.pool.end(), ownedDatabase.lockPool.end()]);
  });
  return app;
}
