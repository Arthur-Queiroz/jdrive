import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { count, desc, eq, sql, sum } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppDatabase } from './db/client.js';
import { files } from './db/schema.js';
import { AppError } from './errors.js';
import { resolveStoragePath, storageConfig } from './storage/config.js';
import { requireSession } from './auth.js';

export async function storageUsedBytes(database: Pick<AppDatabase['db'], 'select'>): Promise<number> {
  const [row] = await database.select({ used: sum(files.sizeBytes) }).from(files);
  return Number(row?.used ?? 0);
}

const storageQuotaLockKey = 'jdrive-storage-quota';

async function withStorageQuotaLock<T>(lockPool: AppDatabase['lockPool'], operation: () => Promise<T>): Promise<T> {
  const lock = await lockPool.connect();
  let acquired = false;
  let result!: T;
  let operationError: unknown;
  try {
    await lock.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [storageQuotaLockKey]);
    acquired = true;
    result = await operation();
  } catch (error) {
    operationError = error;
  } finally {
    let releaseError: Error | undefined;
    if (acquired) {
      try {
        const unlocked = await lock.query('SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked', [storageQuotaLockKey]);
        if (unlocked.rows[0]?.unlocked !== true) releaseError = new Error('Storage quota lock was not held at release');
      } catch (error) {
        releaseError = error instanceof Error ? error : new Error('Failed to release storage quota lock');
      }
    } else if (operationError) {
      releaseError = operationError instanceof Error ? operationError : new Error('Failed to acquire storage quota lock');
    }
    lock.release(releaseError);
  }
  if (operationError !== undefined) throw operationError;
  return result;
}

function safeFilename(name: string) {
  const clean = name.replace(/[\\/\u0000-\u001f\u007f]/g, '_').trim();
  return clean || 'download';
}

function contentDisposition(name: string) {
  const safe = safeFilename(name);
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/["]/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

async function recoverOrphanedFile(database: Pick<AppDatabase['db'], 'insert'>, storageKey: string, filePath: string) {
  const details = await stat(filePath);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  await database.insert(files).values({
    originalName: `recovered-${storageKey}`,
    storageKey,
    mimeType: null,
    sizeBytes: details.size,
    sha256: hash.digest('hex'),
    metadata: { recoveredAfterInterruptedOperation: true },
  }).onConflictDoNothing();
}

export async function reconcilePendingDeletions(database: Pick<AppDatabase['db'], 'select' | 'insert'>): Promise<void> {
  const records = await database.select({ storageKey: files.storageKey }).from(files);
  const trackedKeys = new Set(records.map((record) => String((record as { storageKey: string }).storageKey)));
  const entries = await readdir(storageConfig.filesDir, { withFileTypes: true });
  for (const entry of entries) {
    const match = /^\.delete-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(entry.name);
    if (!entry.isFile() || !match) continue;
    const storageKey = match[1];
    const trashPath = path.join(storageConfig.filesDir, entry.name);
    const originalPath = resolveStoragePath(storageKey);
    if (!trackedKeys.has(storageKey)) {
      await recoverOrphanedFile(database, storageKey, trashPath);
      trackedKeys.add(storageKey);
    }
    try { await stat(originalPath); await rm(trashPath, { force: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await rename(trashPath, originalPath);
    }
  }
  for (const entry of entries) {
    if (!entry.isFile() || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.name)) continue;
    if (!trackedKeys.has(entry.name)) {
      await recoverOrphanedFile(database, entry.name, path.join(storageConfig.filesDir, entry.name));
      trackedKeys.add(entry.name);
    }
  }
}

type UploadPart = { filename: string; mimetype: string; file: NodeJS.ReadableStream & { truncated?: boolean } };

async function storePart(database: Pick<AppDatabase['db'], 'insert'>, part: UploadPart, existing: number) {
  const tempPath = path.join(storageConfig.uploadTmpDir, randomUUID());
  const storageKey = randomUUID();
  const finalPath = resolveStoragePath(storageKey);
  const hash = createHash('sha256');
  let sizeBytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.length;
      if (sizeBytes > storageConfig.maxFileBytes) {
        callback(new AppError(413, 'FILE_TOO_LARGE', 'File exceeds the configured per-file size limit'));
        return;
      }
      if (existing + sizeBytes > storageConfig.maxStorageBytes) {
        callback(new AppError(413, 'STORAGE_LIMIT_EXCEEDED', 'Upload would exceed the configured storage limit'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(part.file, counter, createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }));
    if (part.file.truncated) throw new AppError(413, 'FILE_TOO_LARGE', 'File exceeds the configured per-file size limit');
    await rename(tempPath, finalPath);
    const [record] = await database.insert(files).values({
      originalName: part.filename.replace(/\0/g, '').slice(0, 255) || 'unnamed',
      storageKey,
      mimeType: part.mimetype || null,
      sizeBytes,
      sha256: hash.digest('hex'),
    }).returning();
    return record;
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    await rm(finalPath, { force: true }).catch(() => undefined);
    if (error instanceof AppError) throw error;
    if ((error as NodeJS.ErrnoException)?.code === 'FST_REQ_FILE_TOO_LARGE') {
      throw new AppError(413, 'FILE_TOO_LARGE', 'File exceeds the configured per-file size limit');
    }
    throw error;
  }
}

export async function registerFileRoutes(app: FastifyInstance, database: AppDatabase['db'], lockPool: AppDatabase['lockPool']) {
  const auth = async (request: FastifyRequest, reply: FastifyReply) => requireSession(request, reply, database);

  app.get<{ Querystring: { search?: string; limit?: string; offset?: string } }>('/api/files', { preHandler: auth }, async (request) => {
    const parsePageValue = (value: string | undefined, fallback: number, minimum: number, maximum: number) => {
      if (value === undefined) return fallback;
      if (!/^\d+$/.test(value)) throw new AppError(400, 'INVALID_PAGINATION', 'Pagination values must be integers');
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw new AppError(400, 'INVALID_PAGINATION', 'Pagination values are outside the allowed range');
      }
      return parsed;
    };
    const limit = parsePageValue(request.query.limit, 50, 1, 100);
    const offset = parsePageValue(request.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const term = request.query.search?.trim();
    const escaped = term?.replace(/[!%_]/g, '!$&');
    const filter = escaped ? sql`${files.originalName} ILIKE ${`%${escaped}%`} ESCAPE '!'` : undefined;
    const [rows, countRows] = await Promise.all([
      database.select().from(files).where(filter)
        .orderBy(desc(files.createdAt), desc(files.id))
        .limit(limit)
        .offset(offset),
      database.select({ total: count() }).from(files).where(filter),
    ]);
    return { files: rows, total: Number(countRows[0]?.total ?? 0), limit, offset };
  });

  app.get('/api/storage', { preHandler: auth }, async () => {
    const usedBytes = await storageUsedBytes(database);
    const maxBytes = storageConfig.maxStorageBytes;
    return { usedBytes, maxBytes, percentage: maxBytes > 0 ? Math.round(usedBytes / maxBytes * 10000) / 100 : 0 };
  });

  app.post('/api/files', { preHandler: auth }, async (request, reply) => {
    if (!request.isMultipart()) throw new AppError(400, 'INVALID_MULTIPART', 'Expected multipart form data');
    const stored: Array<Awaited<ReturnType<typeof storePart>>> = [];
    await withStorageQuotaLock(lockPool, async () => {
      try {
        let usedBytes = await storageUsedBytes(database);
        for await (const part of request.parts()) {
          if (part.type !== 'file') continue;
          const record = await storePart(database, part, usedBytes);
          stored.push(record);
          usedBytes += record.sizeBytes;
        }
      } catch (error) {
        if (stored.length) {
          try {
            await database.transaction(async (transaction) => {
              for (const item of stored) await transaction.delete(files).where(eq(files.id, item.id));
            });
          } catch (cleanupError) {
            app.log.error({ err: cleanupError, fileIds: stored.map((item) => item.id) }, 'Failed to roll back upload metadata; retaining stored files');
            throw error;
          }
          for (const item of stored) {
            await rm(resolveStoragePath(item.storageKey), { force: true }).catch(async (cleanupError) => {
              try { await database.insert(files).values(item).onConflictDoNothing(); }
              catch (restoreError) {
                app.log.error({ err: restoreError, fileId: item.id }, 'Failed to retain metadata for an upload file that could not be removed');
              }
              app.log.error({ err: cleanupError, fileId: item.id }, 'Failed to remove file after upload rollback; metadata was retained for quota accounting');
            });
          }
        }
        throw error;
      }
    });
    if (!stored.length) throw new AppError(400, 'NO_FILES', 'At least one file is required');
    return reply.code(201).send({ files: stored });
  });

  app.get<{ Params: { id: string } }>('/api/files/:id/download', { preHandler: auth }, async (request, reply) => {
    const [file] = await database.select().from(files).where(eq(files.id, request.params.id)).limit(1);
    if (!file) throw new AppError(404, 'FILE_NOT_FOUND', 'File not found');
    const filePath = resolveStoragePath(file.storageKey);
    try { await stat(filePath); } catch { throw new AppError(404, 'FILE_NOT_FOUND', 'File not found'); }
    reply.header('Content-Type', file.mimeType || 'application/octet-stream');
    reply.header('Content-Length', String(file.sizeBytes));
    reply.header('Content-Disposition', contentDisposition(file.originalName));
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(createReadStream(filePath));
  });

  app.delete<{ Params: { id: string } }>('/api/files/:id', { preHandler: auth }, async (request, reply) => {
    await withStorageQuotaLock(lockPool, async () => {
      const [file] = await database.select().from(files).where(eq(files.id, request.params.id)).limit(1);
      if (!file) throw new AppError(404, 'FILE_NOT_FOUND', 'File not found');
      const filePath = resolveStoragePath(file.storageKey);
      const trashPath = path.join(storageConfig.filesDir, `.delete-${file.storageKey}`);
      let moved = false;
      try {
        await rename(filePath, trashPath);
        moved = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      let deleted: unknown[];
      try {
        deleted = await database.delete(files).where(eq(files.id, file.id)).returning();
      } catch (error) {
        if (moved) {
          try { await rename(trashPath, filePath); }
          catch (restoreError) { app.log.error({ err: restoreError, fileId: file.id }, 'Failed to restore file after database delete error'); }
        }
        throw error;
      }
      if (!deleted.length) {
        if (moved) await rename(trashPath, filePath);
        throw new AppError(404, 'FILE_NOT_FOUND', 'File not found');
      }
      if (moved) {
        try { await unlink(trashPath); }
        catch (error) {
          try {
            await database.insert(files).values({
              id: file.id,
              originalName: file.originalName,
              storageKey: file.storageKey,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
              sha256: file.sha256,
              metadata: file.metadata,
              createdAt: file.createdAt,
            }).onConflictDoNothing();
            await rename(trashPath, filePath).catch((restoreError) => {
              app.log.error({ err: restoreError, fileId: file.id }, 'Failed to restore deleted file; startup reconciliation will recover it');
            });
          } catch (restoreError) {
            app.log.error({ err: restoreError, fileId: file.id }, 'Failed to restore file metadata after cleanup failure; startup reconciliation will clean orphaned bytes');
          }
          throw error;
        }
      }
    });
    return reply.code(204).send();
  });
}
