import { mkdir, open, realpath, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const resolveDirectory = (value: string | undefined, fallback: string) => path.resolve(projectRoot, value ?? fallback);
const maxFileBytes = Number(process.env.MAX_FILE_SIZE_MB ?? 1024) * 1024 * 1024;
const maxStorageBytes = Math.floor(Number(process.env.MAX_STORAGE_GB ?? 10) * 1024 * 1024 * 1024);
if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) throw new Error('MAX_FILE_SIZE_MB must be a positive safe integer');
if (!Number.isSafeInteger(maxStorageBytes) || maxStorageBytes <= 0) throw new Error('MAX_STORAGE_GB must be a positive safe integer');

const filesDir = resolveDirectory(process.env.FILES_DIR ?? process.env.STORAGE_FILES_DIR, 'data/files');
const tmpDir = resolveDirectory(process.env.TMP_DIR ?? process.env.STORAGE_TMP_DIR, 'data/tmp');
const uploadTmpDir = path.join(tmpDir, randomUUID());

export const storageConfig = {
  filesDir,
  tmpDir,
  uploadTmpDir,
  maxFileBytes,
  maxStorageBytes,
};

export async function initializeStorage() {
  await mkdir(storageConfig.filesDir, { recursive: true, mode: 0o750 });
  await mkdir(storageConfig.tmpDir, { recursive: true, mode: 0o700 });
  await mkdir(storageConfig.uploadTmpDir, { recursive: true, mode: 0o700 });
  const [filesReal, tmpReal] = await Promise.all([realpath(storageConfig.filesDir), realpath(storageConfig.uploadTmpDir)]);
  if (filesReal === tmpReal) throw new Error('FILES_DIR and TMP_DIR must be separate directories');
  const [filesStat, tmpStat] = await Promise.all([stat(filesReal), stat(tmpReal)]);
  if (filesStat.dev !== tmpStat.dev) throw new Error('FILES_DIR and TMP_DIR must be on the same filesystem for atomic uploads');

  for (const directory of [storageConfig.filesDir, storageConfig.uploadTmpDir]) {
    const probe = path.join(directory, randomUUID());
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(probe, 'wx', 0o600);
    } finally {
      await handle?.close();
      await unlink(probe).catch(() => undefined);
    }
  }
}

export function resolveStoragePath(storageKey: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storageKey)) {
    throw new Error('Invalid storage key');
  }
  return path.join(storageConfig.filesDir, storageKey.toLowerCase());
}
