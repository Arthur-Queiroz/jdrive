import './env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { createDatabase } from './db/client.js';
import { waitForDatabase } from './startup.js';
import { bootstrapInitialUser } from './auth.js';
import { initializeStorage, storageConfig } from './storage/config.js';
import { buildServer } from './app.js';
import { reconcilePendingDeletions } from './file-routes.js';
import { cleanupStaleChunkUploads } from './chunks.js';

async function start() {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret || Buffer.byteLength(sessionSecret) < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 bytes');
  }
  const { db, pool, lockPool } = createDatabase();
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  try {
    await waitForDatabase(async () => { await db.execute(sql`select 1`); });
    await migrate(db, { migrationsFolder: path.resolve(moduleDir, '../drizzle') });
    await bootstrapInitialUser(db);
    await initializeStorage();
    await reconcilePendingDeletions(db);
    await cleanupStaleChunkUploads();
    const app = buildServer({ database: { db, pool, lockPool } });
    app.addHook('onClose', async () => { await Promise.all([pool.end(), lockPool.end()]); });
    const port = Number(process.env.PORT ?? 3000);
    const host = process.env.HOST ?? '0.0.0.0';
    await app.listen({ port, host });
    console.info(`JDrive listening on ${host}:${port}`);
    const shutdown = async () => {
      try { await app.close(); }
      finally {
        await rm(storageConfig.uploadTmpDir, { recursive: true, force: true }).catch(() => undefined);
        process.exit(0);
      }
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } catch (error) {
    await Promise.all([pool.end(), lockPool.end()]);
    throw error;
  }
}

start().catch((error: unknown) => {
  console.error('JDrive startup failed:', error instanceof Error ? error.message : 'unknown error');
  process.exit(1);
});
