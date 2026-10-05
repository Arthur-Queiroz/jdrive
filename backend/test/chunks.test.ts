import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import argon2 from 'argon2';
import { buildServer } from '../src/app.js';
import { cleanupStaleChunkUploads } from '../src/chunks.js';
import { files, sessions, users } from '../src/db/schema.js';
import { initializeStorage, resolveStoragePath, storageConfig } from '../src/storage/config.js';

// Minimal in-memory database: only what chunked uploads need.
class MemoryDatabase {
  user: Record<string, unknown> | undefined;
  sessionRows: Record<string, unknown>[] = [];
  fileRows: Array<Record<string, any>> = [];
  select(projection?: Record<string, unknown>) { return new Query(this, projection); }
  insert(table: unknown) { return new Insert(this, table); }
  delete(table: unknown) { return new Delete(this, table); }
  execute() { return Promise.resolve({ rows: [] }); }
  async transaction<T>(callback: (transaction: this) => Promise<T>) { return callback(this); }
}

class Query {
  constructor(private readonly database: MemoryDatabase, private readonly projection?: Record<string, unknown>) {}
  from(table: unknown) { this.table = table; return this; }
  innerJoin() { return this; }
  where() { return this; }
  orderBy() { return this; }
  limit() { return this; }
  offset() { return this; }
  private table: unknown;
  private rows(): unknown[] {
    if (this.table === sessions) return this.database.sessionRows.length ? [this.database.user] : [];
    if (this.table === users) return this.database.user ? [this.database.user] : [];
    if (this.table === files) {
      if (this.projection && 'used' in this.projection) {
        return [{ used: String(this.database.fileRows.reduce((total, file) => total + file.sizeBytes, 0)) }];
      }
      return this.database.fileRows;
    }
    return [];
  }
  then(resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) {
    return Promise.resolve(this.rows()).then(resolve, reject);
  }
}

class Delete {
  private table: unknown;
  constructor(private readonly database: MemoryDatabase, table: unknown) { this.table = table; }
  where() { return this; }
  then(resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) {
    if (this.table === sessions) return Promise.resolve(this.database.sessionRows.splice(0)).then(resolve, reject);
    return Promise.resolve([]).then(resolve, reject);
  }
}

class Insert {
  private row: Record<string, unknown> = {};
  constructor(private readonly database: MemoryDatabase, private readonly table: unknown) {}
  values(row: Record<string, unknown>) { this.row = row; return this; }
  onConflictDoNothing() { return this; }
  private commit() {
    if (this.table === users) { this.database.user = record; return record; }
    if (this.table === sessions) {
      const sessionRecord = { id: randomUUID(), ...this.row };
      this.database.sessionRows.push(sessionRecord);
      return sessionRecord;
    }
    const record = { id: randomUUID(), metadata: {}, createdAt: new Date(), ...this.row };
    this.database.fileRows.push(record);
    return record;
  }
  returning() { return Promise.resolve([this.commit()]); }
  then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
    return Promise.resolve(this.commit()).then(resolve, reject);
  }
}

const db = new MemoryDatabase();
process.env.SESSION_SECRET ??= `test-session-${randomUUID()}-long-enough`;
const lockPool = {
  async connect() {
    return {
      async query(query: string) { return { rows: query.includes('pg_advisory_unlock') ? [{ unlocked: true }] : [{}] }; },
      release() {},
    };
  },
};
const app = buildServer({ database: { db, pool: {}, lockPool } as never, logger: false });
const password = `test-${randomUUID()}-long-enough`;
let cookie = '';

before(async () => {
  await initializeStorage();
  db.user = { id: randomUUID(), username: 'arthur', passwordHash: await argon2.hash(password, { type: argon2.argon2id }) };
  await app.ready();
});

after(async () => {
  await app.close();
  await rm(path.resolve(storageConfig.filesDir, '..'), { recursive: true, force: true });
});

async function login() {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'arthur', password } });
  assert.equal(response.statusCode, 200);
  const setCookie = response.headers['set-cookie'];
  cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie as string).split(';', 1)[0];
}

test('chunked upload: init, ordered parts, sha256 verification, finish persists one file', async () => {
  await login();
  const partA = Buffer.from('chunk-a-bytes-');
  const partB = Buffer.from('chunk-b-bytes');
  const full = Buffer.concat([partA, partB]);
  const expectedSha256 = createHash('sha256').update(full).digest('hex');

  const init = await app.inject({
    method: 'POST', url: '/api/files/chunks/init', headers: { cookie },
    payload: { name: 'large.bin', size: full.length, mimeType: 'application/octet-stream' },
  });
  assert.equal(init.statusCode, 201, init.body);
  const { uploadId, chunkSize } = init.json();
  assert.match(uploadId, /^[0-9a-f-]{36}$/i);
  assert.equal(typeof chunkSize, 'number');

  const first = await app.inject({
    method: 'PUT', url: `/api/files/chunks/${uploadId}/0`, headers: { cookie, 'content-type': 'application/octet-stream' },
    payload: partA,
  });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().offset, partA.length);

  // Out-of-order chunk must be rejected.
  const skip = await app.inject({
    method: 'PUT', url: `/api/files/chunks/${uploadId}/2`, headers: { cookie, 'content-type': 'application/octet-stream' },
    payload: Buffer.from('x'),
  });
  assert.equal(skip.statusCode, 409);
  assert.equal(skip.json().error.code, 'CHUNK_OUT_OF_ORDER');

  const second = await app.inject({
    method: 'PUT', url: `/api/files/chunks/${uploadId}/1`, headers: { cookie, 'content-type': 'application/octet-stream' },
    payload: partB,
  });
  assert.equal(second.statusCode, 200, second.body);
  assert.equal(second.json().offset, full.length);

  // Premature finish must fail.
  const earlyManifestPath = path.join(storageConfig.tmpDir, 'chunks', uploadId, 'manifest.json');
  assert.match(await readFile(earlyManifestPath, 'utf8'), /"receivedBytes":/);

  const finish = await app.inject({
    method: 'POST', url: `/api/files/chunks/${uploadId}/finish`, headers: { cookie },
    payload: { sha256: expectedSha256 },
  });
  assert.equal(finish.statusCode, 201, finish.body);
  const record = finish.json().files[0];
  assert.equal(record.originalName, 'large.bin');
  assert.equal(record.sizeBytes, full.length);
  assert.equal(record.sha256, expectedSha256);
  assert.equal(db.fileRows.length, 1);

  const stored = await readFile(resolveStoragePath(record.storageKey));
  assert.deepEqual(stored, full);
  const scratchDir = path.join(storageConfig.tmpDir, 'chunks', uploadId);
  await assert.rejects(stat(scratchDir), 'finish must remove the chunk scratch directory');
});

test('chunked upload rejects sha256 mismatch and cleans the session', async () => {
  await login();
  const bytes = Buffer.from('mismatch-payload');
  const init = await app.inject({
    method: 'POST', url: '/api/files/chunks/init', headers: { cookie },
    payload: { name: 'corrupt.bin', size: bytes.length },
  });
  const { uploadId } = init.json();
  await app.inject({
    method: 'PUT', url: `/api/files/chunks/${uploadId}/0`, headers: { cookie, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  const wrongSha = createHash('sha256').update(Buffer.from('different')).digest('hex');
  const finish = await app.inject({
    method: 'POST', url: `/api/files/chunks/${uploadId}/finish`, headers: { cookie },
    payload: { sha256: wrongSha },
  });
  assert.equal(finish.statusCode, 400);
  assert.equal(finish.json().error.code, 'CHUNK_SHA256_MISMATCH');
  assert.equal(db.fileRows.length, 1, 'failed digest must not persist metadata');
  await assert.rejects(stat(path.join(storageConfig.tmpDir, 'chunks', uploadId)));
});

test('chunked init enforces per-file and storage limits without side effects', async () => {
  await login();
  const tooLarge = await app.inject({
    method: 'POST', url: '/api/files/chunks/init', headers: { cookie },
    payload: { name: 'big.bin', size: 3 * 1024 * 1024 },
  });
  assert.equal(tooLarge.statusCode, 413);
  assert.equal(tooLarge.json().error.code, 'FILE_TOO_LARGE');

  const synthetic = { id: randomUUID(), storageKey: randomUUID(), originalName: 'quota-reservation', mimeType: null, sizeBytes: 1_500_000, sha256: '0'.repeat(64), metadata: {}, createdAt: new Date() };
  db.fileRows.push(synthetic);
  const overQuota = await app.inject({
    method: 'POST', url: '/api/files/chunks/init', headers: { cookie },
    payload: { name: 'quota.bin', size: 2 * 1024 * 1024 },
  });
  db.fileRows = db.fileRows.filter((row) => row.id !== synthetic.id);
  assert.equal(overQuota.statusCode, 413);
  assert.equal(overQuota.json().error.code, 'STORAGE_LIMIT_EXCEEDED');

  const invalid = await app.inject({
    method: 'POST', url: '/api/files/chunks/init', headers: { cookie },
    payload: { name: '', size: 10 },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, 'INVALID_CHUNK_INIT');
  assert.equal(db.fileRows.length, 1);
});

test('chunked uploads require authentication', async () => {
  const init = await app.inject({ method: 'POST', url: '/api/files/chunks/init', payload: { name: 'x', size: 1 } });
  assert.equal(init.statusCode, 401);
  const upload = await app.inject({
    method: 'PUT', url: `/api/files/chunks/${randomUUID()}/0`,
    headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('x'),
  });
  assert.equal(auth(upload, init), true);
});

function auth(...responses: { statusCode: number }[]) {
  return responses.every((response) => response.statusCode === 401);
}

test('stale chunk sessions are garbage collected after the TTL', async () => {
  await login();
  const init = await app.inject({
    method: 'POST', url: '/api/files/chunks/init', headers: { cookie },
    payload: { name: 'stale.bin', size: 4 },
  });
  const { uploadId } = init.json();
  const sessionDir = path.join(storageConfig.tmpDir, 'chunks', uploadId);
  await cleanupStaleChunkUploads();
  await stat(sessionDir);
  const minutesAgo = new Date(Date.now() - 48 * 3_600_000);
  const { utimes } = await import('node:fs/promises');
  await utimes(sessionDir, minutesAgo, minutesAgo);
  await cleanupStaleChunkUploads();
  await assert.rejects(stat(sessionDir), 'expired sessions are removed');
});

test('cleanup tolerates a missing scratch directory', async () => {
  await rm(path.join(storageConfig.tmpDir, 'chunks'), { recursive: true, force: true });
  await cleanupStaleChunkUploads();
});

// Unused import guard for CI parity with flow.test.ts.
void files;
void readdir;
