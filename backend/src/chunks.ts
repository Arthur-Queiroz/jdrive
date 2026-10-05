import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppDatabase } from './db/client.js';
import { files } from './db/schema.js';
import { AppError } from './errors.js';
import { resolveStoragePath, storageConfig } from './storage/config.js';
import { requireSession } from './auth.js';
import { storageUsedBytes } from './file-routes.js';

/**
 * Chunked uploads exist because the public hostname is proxied by Cloudflare
 * Free, whose request-body limit (100 MB) rejects large single-request uploads
 * before they reach this backend. Each chunk must stay under the edge limit.
 */

const chunkedScratchDir = path.join(storageConfig.tmpDir, 'chunks');
const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHUNK_INDEX_PATTERN = /^\d+$/;
// Keep every chunk comfortably below the smallest edge/proxy body cap.
export const CHUNK_SIZE = 64 * 1024 * 1024;

type ChunkManifest = {
  name: string;
  mimeType: string | null;
  sizeBytes: number;
  receivedCount: number;
  receivedBytes: number;
  storageKey: string;
  createdAt: string;
};

type InitPayload = { name?: unknown; size?: unknown; mimeType?: unknown };
type FinishPayload = { sha256?: unknown };

async function readManifest(sessionDir: string): Promise<ChunkManifest> {
  let raw: string;
  try {
    raw = await import('node:fs/promises').then((fs) => fs.readFile(path.join(sessionDir, 'manifest.json'), 'utf8'));
  } catch {
    throw new AppError(404, 'CHUNK_SESSION_NOT_FOUND', 'Chunked upload session does not exist (or expired)');
  }
  try {
    return JSON.parse(raw) as ChunkManifest;
  } catch {
    throw new AppError(409, 'CHUNK_SESSION_CORRUPT', 'Chunked upload session manifest is unreadable');
  }
}

async function saveManifest(sessionDir: string, manifest: ChunkManifest) {
  await writeFile(path.join(sessionDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
}

export async function cleanupStaleChunkUploads(nowMs: number = Date.now()) {
  const ttlMs = Number(process.env.CHUNK_TTL_HOURS ?? 24) * 3_600_000;
  let entries: import('node:fs').Dirent[] = [];
  try {
    entries = await readdir(chunkedScratchDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !UPLOAD_ID_PATTERN.test(entry.name)) continue;
    const sessionDir = path.join(chunkedScratchDir, entry.name);
    const details = await stat(sessionDir).catch(() => undefined);
    if (!details) continue;
    if (nowMs - details.mtime.getTime() < ttlMs) continue;
    await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function chunkPath(sessionDir: string, index: number) {
  return path.join(sessionDir, `chunk-${String(index).padStart(6, '0')}`);
}

function enforceSizeLimit(sizeBytes: number) {
  if (sizeBytes > storageConfig.maxFileBytes) {
    throw new AppError(413, 'FILE_TOO_LARGE', 'File exceeds the configured per-file size limit');
  }
}

async function enforceStorageLimit(database: AppDatabase['db'], totalBytes: number) {
  const used = await storageUsedBytes(database);
  if (used > 0 && used + totalBytes > storageConfig.maxStorageBytes) {
    throw new AppError(413, 'STORAGE_LIMIT_EXCEEDED', 'Upload would exceed the configured storage limit');
  }
  if (used === 0 && totalBytes > storageConfig.maxStorageBytes) {
    throw new AppError(413, 'STORAGE_LIMIT_EXCEEDED', 'Upload would exceed the configured storage limit');
  }
}

export function registerChunkRoutes(
  app: FastifyInstance,
  database: AppDatabase['db'],
  lockPool: AppDatabase['lockPool'],
) {
  const auth = async (request: FastifyRequest, reply: FastifyReply) => requireSession(request, reply, database);

  app.post('/api/files/chunks/init', { preHandler: auth }, async (request, reply) => {
    const body = (request.body ?? {}) as InitPayload;
    const name = typeof body.name === 'string' ? body.name.replace(/\0/g, '').trim().slice(0, 255) : '';
    const size = typeof body.size === 'number' ? body.size : Number(body.size);
    const mimeType = typeof body.mimeType === 'string' && body.mimeType.trim() ? body.mimeType.trim().slice(0, 255) : null;
    if (!name) throw new AppError(400, 'INVALID_CHUNK_INIT', 'A non-empty file name is required');
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new AppError(400, 'INVALID_CHUNK_INIT', 'Declared size must be a positive integer');
    }
    enforceSizeLimit(size);
    await enforceStorageLimit(database, size);
    const uploadId = randomUUID();
    const sessionDir = path.join(chunkedScratchDir, uploadId);
    await mkdir(sessionDir, { recursive: true, mode: 0o700 });
    await saveManifest(sessionDir, {
      name,
      mimeType,
      sizeBytes: size,
      receivedCount: 0,
      receivedBytes: 0,
      storageKey: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    return reply.code(201).send({ uploadId, chunkSize: CHUNK_SIZE });
  });

  app.put<{ Params: { uploadId: string; index: string } }>(
    '/api/files/chunks/:uploadId/:index',
    {
      preHandler: auth,
    },
    async (request) => {
      const index = Number(request.params.index);
      if (!CHUNK_INDEX_PATTERN.test(request.params.index) || !Number.isSafeInteger(index) || index < 0) {
        throw new AppError(400, 'INVALID_CHUNK_INDEX', 'Chunk index must be a non-negative integer');
      }
      if (!UPLOAD_ID_PATTERN.test(request.params.uploadId)) {
        throw new AppError(400, 'INVALID_CHUNK_SESSION', 'Malformed chunked upload id');
      }
      const sessionDir = path.join(chunkedScratchDir, request.params.uploadId);
      const manifest = await readManifest(sessionDir);
      enforceSizeLimit(manifest.sizeBytes);
      if (index !== manifest.receivedCount) {
        throw new AppError(409, 'CHUNK_OUT_OF_ORDER', `Expected chunk index ${manifest.receivedCount}, received ${index}`);
      }

      const targetPath = chunkPath(sessionDir, index);
      const body = request.body as Buffer | undefined;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw new AppError(400, 'INVALID_CHUNK_BODY', 'Expected a non-empty octet-stream chunk body');
      }
      if (manifest.receivedBytes + body.length > manifest.sizeBytes) {
        throw new AppError(400, 'CHUNK_SIZE_OVERFLOW',
          'Chunked upload received more bytes than declared in init');
      }
      try {
        await writeFile(targetPath, body, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        await rm(targetPath, { force: true }).catch(() => undefined);
        throw error;
      }

      manifest.receivedCount = index + 1;
      manifest.receivedBytes += body.length;
      await saveManifest(sessionDir, manifest);
      return { offset: manifest.receivedBytes };
    },
  );

  app.post<{ Params: { uploadId: string } }>(
    '/api/files/chunks/:uploadId/finish',
    { preHandler: auth },
    async (request, reply) => {
      const uploadId = request.params.uploadId;
      if (!UPLOAD_ID_PATTERN.test(uploadId)) {
        throw new AppError(400, 'INVALID_CHUNK_SESSION', 'Malformed chunked upload id');
      }
      const body = (request.body ?? {}) as FinishPayload;
      const expectedSha256 = typeof body.sha256 === 'string' ? body.sha256.toLowerCase() : '';
      if (!/^[0-9a-f]{64}$/.test(expectedSha256)) {
        throw new AppError(400, 'INVALID_CHUNK_FINISH', 'A lowercase sha256 hex digest is required');
      }
      const sessionDir = path.join(chunkedScratchDir, uploadId);
      const manifest = await readManifest(sessionDir);
      if (manifest.receivedBytes !== manifest.sizeBytes) {
        throw new AppError(409, 'CHUNK_UPLOAD_INCOMPLETE',
          `Upload declares ${manifest.sizeBytes} bytes but ${manifest.receivedBytes} were received`);
      }
      enforceSizeLimit(manifest.sizeBytes);
      await enforceStorageLimit(database, manifest.sizeBytes);

      const finalPath = resolveStoragePath(manifest.storageKey);
      const digest = await sha256OfFilePaths(sessionDir, manifest.receivedCount);
      if (digest !== expectedSha256) {
        await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
        throw new AppError(400, 'CHUNK_SHA256_MISMATCH',
          'Client digest does not match stored bytes; retry the upload');
      }

      try {
        await concatenateFinal(sessionDir, manifest.receivedCount, finalPath);
      } finally {
        // Scratch chunks are removed below; concat outcome decides everything.
      }
      const [record] = await database.insert(files).values({
        originalName: manifest.name,
        storageKey: manifest.storageKey,
        mimeType: manifest.mimeType,
        sizeBytes: manifest.sizeBytes,
        sha256: digest,
      }).returning();
      await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
      return reply.code(201).send({ files: [record] });
    },
  );
}

async function concatenateFinal(sessionDir: string, chunkCount: number, finalPath: string): Promise<void> {
  const { open, unlink } = await import('node:fs/promises');
  const out = await open(finalPath, 'wx', 0o600);
  try {
    for (let index = 0; index < chunkCount; index += 1) {
      const chunkFilePath = chunkPath(sessionDir, index);
      const bytes = await import('node:fs/promises').then((fs) => fs.readFile(chunkFilePath));
      await out.write(bytes);
      await unlink(chunkFilePath).catch(() => undefined);
    }
  } finally {
    await out.close();
  }
}

async function sha256OfFilePaths(sessionDir: string, chunkCount: number): Promise<string> {
  const { createReadStream } = await import('node:fs');
  const hash = createHash('sha256');
  for (let index = 0; index < chunkCount; index += 1) {
    const stream = createReadStream(chunkPath(sessionDir, index));
    for await (const chunk of stream) hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}
