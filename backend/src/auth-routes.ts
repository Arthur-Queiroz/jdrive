import type { FastifyInstance } from 'fastify';
import { and, eq, gt } from 'drizzle-orm';
import argon2 from 'argon2';
import { users, sessions } from './db/schema.js';
import type { AppDatabase } from './db/client.js';
import { authenticatedUser, createSession, hashToken, requireSession, SESSION_COOKIE, setSessionCookie } from './auth.js';
import { AppError } from './errors.js';

export async function registerAuthRoutes(app: FastifyInstance, database: AppDatabase['db']) {
  app.post<{ Body: { username?: string; password?: string } }>('/api/auth/login', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const username = request.body?.username;
    const password = request.body?.password;
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || password.length < 1 || password.length > 1024) {
      throw new AppError(400, 'INVALID_REQUEST', 'Username and password are required');
    }
    const [user] = await database.select().from(users).where(eq(users.username, username.trim())).limit(1);
    const valid = user ? await argon2.verify(user.passwordHash, password).catch(() => false) : false;
    if (!user || !valid) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
    const { token, expiresAt } = await createSession(database, user.id);
    setSessionCookie(reply, token, expiresAt);
    return reply.code(200).send({ user: { id: user.id, username: user.username } });
  });

  app.get('/api/auth/me', async (request, reply) => {
    const user = await authenticatedUser(database, request.cookies[SESSION_COOKIE]);
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    return { user };
  });

  app.post('/api/auth/logout', { preHandler: async (request, reply) => requireSession(request, reply, database) }, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await database.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
    return reply.code(204).send();
  });
}
