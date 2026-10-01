import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { and, count, eq, gt, ilike } from 'drizzle-orm';
import { createDatabase } from '../src/db/client.js';
import { files, sessions, users } from '../src/db/schema.js';

process.env.FILES_DIR = '.test-data-postgres/files';
process.env.TMP_DIR = '.test-data-postgres/tmp';

const [{ buildServer }, { createSession }] = await Promise.all([
  import('../src/app.js'),
  import('../src/auth.js'),
]);

process.env.SESSION_SECRET ??= 'postgres-integration-session-secret-32-bytes';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const destructiveTestDatabaseAllowed = process.env.ALLOW_DESTRUCTIVE_TEST_DB === '1';

test('PostgreSQL migrations support users, sessions, private files and case-insensitive search', {
  skip: !testDatabaseUrl || !destructiveTestDatabaseAllowed,
}, async () => {
  const { db, pool, lockPool } = createDatabase(testDatabaseUrl);
  let userId: string | undefined;
  try {
    await db.delete(sessions);
    await db.delete(files);
    await db.delete(users);

    const [user] = await db.insert(users).values({ username: 'jdrive-integration', passwordHash: 'test-only-hash' }).returning();
    assert.ok(user?.id);
    userId = user.id;

    const expiresAt = new Date(Date.now() + 60_000);
    const tokenHash = 'a'.repeat(64);
    await db.insert(sessions).values({ userId: user.id, tokenHash, expiresAt });
    const [activeSession] = await db.select().from(sessions).where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())));
    assert.equal(activeSession?.userId, user.id);

    const storageKey = 'b1d45751-3ab0-41a8-a824-7443f2c19827';
    await db.insert(files).values({
      originalName: 'Quarterly REPORT.pdf',
      storageKey,
      mimeType: 'application/pdf',
      sizeBytes: 42,
      sha256: 'b'.repeat(64),
    });
    await db.insert(files).values({
      originalName: 'Monthly report.txt',
      storageKey: randomUUID(),
      mimeType: 'text/plain',
      sizeBytes: 12,
      sha256: 'c'.repeat(64),
    });
    await db.insert(files).values({
      originalName: 'Holiday notes.txt',
      storageKey: randomUUID(),
      mimeType: 'text/plain',
      sizeBytes: 14,
      sha256: 'd'.repeat(64),
    });
    const [found] = await db.select().from(files).where(ilike(files.originalName, '%report%'));
    assert.equal(found?.storageKey, storageKey);
    assert.equal(found?.sizeBytes, 42);
    const [matchingFiles] = await db.select({ total: count() }).from(files).where(ilike(files.originalName, '%report%'));
    assert.equal(matchingFiles.total, 2);

    const app = buildServer({ database: { db, pool, lockPool } });
    const { token } = await createSession(db, user.id);
    try {
      await app.ready();
      const pageOne = await app.inject({ method: 'GET', url: '/api/files?search=REPORT&limit=1&offset=0', headers: { cookie: `jdrive_session=${token}` } });
      assert.equal(pageOne.statusCode, 200);
      assert.equal(pageOne.json().total, 2);
      assert.equal(pageOne.json().files.length, 1);
      assert.equal(pageOne.json().limit, 1);
      assert.equal(pageOne.json().offset, 0);
      const pageTwo = await app.inject({ method: 'GET', url: '/api/files?search=report&limit=1&offset=1', headers: { cookie: `jdrive_session=${token}` } });
      assert.equal(pageTwo.statusCode, 200);
      assert.equal(pageTwo.json().total, 2);
      assert.equal(pageTwo.json().files.length, 1);
      assert.notEqual(pageTwo.json().files[0].id, pageOne.json().files[0].id);
    } finally {
      await app.close();
    }

  } finally {
    try {
      if (userId) {
        await db.delete(sessions).where(eq(sessions.userId, userId));
        await db.delete(files);
        await db.delete(users).where(eq(users.id, userId));
      }
    } finally {
      await Promise.all([pool.end(), lockPool.end()]);
    }
  }
});
