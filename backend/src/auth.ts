import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHmac, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { and, eq, gt, sql } from 'drizzle-orm';
import { sessions, users } from './db/schema.js';
import type { AppDatabase } from './db/client.js';

export const SESSION_COOKIE = 'jdrive_session';
export const hashToken = (token: string) => {
  const secret = process.env.SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error('SESSION_SECRET must contain at least 32 bytes');
  return createHmac('sha256', secret).update(token).digest('hex');
};

export async function bootstrapInitialUser(database: AppDatabase['db']) {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  const existing = await database.select({ id: users.id }).from(users).limit(1);
  if (existing.length) return;
  if (!username && !password) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Set ADMIN_USERNAME and ADMIN_INITIAL_PASSWORD before first production startup');
    }
    return;
  }
  if (!username || !password || password.length < 16) {
    throw new Error('Set both ADMIN_USERNAME and ADMIN_INITIAL_PASSWORD (minimum 16 characters)');
  }
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  await database.insert(users).values({ username, passwordHash }).onConflictDoNothing({ target: users.username });
}

export async function createSession(database: AppDatabase['db'], userId: string) {
  const token = randomBytes(32).toString('base64url');
  const ttlDays = Number(process.env.SESSION_TTL_DAYS ?? 7);
  if (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > 30) throw new Error('SESSION_TTL_DAYS must be between 1 and 30');
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
  await database.delete(sessions).where(sql`${sessions.expiresAt} <= now()`);
  await database.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  return { token, expiresAt };
}

export async function authenticatedUser(database: AppDatabase['db'], token?: string) {
  if (!token || token.length > 128) return undefined;
  const [row] = await database.select({ id: users.id, username: users.username })
    .from(sessions).innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row;
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    expires: expiresAt,
  });
}

export async function requireSession(request: FastifyRequest, reply: FastifyReply, database: AppDatabase['db']) {
  const user = await authenticatedUser(database, request.cookies[SESSION_COOKIE]);
  if (!user) {
    await reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    return;
  }
  request.authenticatedUser = user;
}

declare module 'fastify' {
  interface FastifyRequest {
    authenticatedUser?: { id: string; username: string };
  }
}
