import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { access, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import argon2 from 'argon2';
import { buildServer } from '../src/app.js';
import { files, sessions, users } from '../src/db/schema.js';
import { reconcilePendingDeletions } from '../src/file-routes.js';
import { initializeStorage, resolveStoragePath, storageConfig } from '../src/storage/config.js';

class Query {
  table: unknown;
  joined = false;
  constructor(private readonly database: MemoryDatabase, private readonly projection?: Record<string, unknown>) {}
  from(table: unknown) { this.table = table; return this; }
  innerJoin() { this.joined = true; return this; }
  where() { return this; }
  orderBy() { return this; }
  limit(count: number) { this.take = count; return this; }
  offset(count: number) { this.skip = count; return Promise.resolve(this.rows().slice(this.skip, this.skip + this.take)); }
  private take = 1;
  private skip = 0;
  private rows(): unknown[] {
    if (this.table === sessions) return this.database.sessionRows.length ? [this.database.user] : [];
    if (this.table === users) return this.database.user ? [this.database.user] : [];
    if (this.table === files) {
      if (this.projection && 'used' in this.projection) return [{ used: String(this.database.fileRows.reduce((total, file) => total + file.sizeBytes, 0)) }];
      if (this.projection && 'total' in this.projection) return [{ total: String(this.database.fileRows.length) }];
      return this.database.fileRows;
    }
    return [];
  }
  then(resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) {
    return Promise.resolve(this.rows()).then(resolve, reject);
  }
}

class Insert {
  private row: Record<string, unknown> = {};
  constructor(private readonly database: MemoryDatabase, private readonly table: unknown) {}
  values(row: Record<string, unknown>) { this.row = row; return this; }
  onConflictDoNothing() { return this; }
  private commit() {
    if (this.table === users) {
      this.database.user = { id: this.row.id ?? randomUUID(), ...this.row };
      return this.database.user;
    }
    if (this.table === sessions) {
      const record = { id: randomUUID(), ...this.row };
      this.database.sessionRows.push(record);
      return record;
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

class Delete {
  private done?: unknown[];
  constructor(private readonly database: MemoryDatabase, private readonly table: unknown) {}
  where() { return this; }
  private commit() {
    if (this.done) return this.done;
    if (this.table === sessions) { this.done = this.database.sessionRows.splice(0); return this.done; }
    if (this.table === files) { this.done = this.database.fileRows.splice(0); return this.done; }
    this.done = [];
    return this.done;
  }
  returning() {
    if (this.table === files && this.database.failFileDelete) { this.database.failFileDelete = false; return Promise.reject(new Error('simulated database delete failure')); }
    return Promise.resolve(this.commit());
  }
  then(resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) {
    if (this.table === files && this.database.failFileDelete) { this.database.failFileDelete = false; return Promise.reject(new Error('simulated database delete failure')).then(resolve, reject); }
    return Promise.resolve(this.commit()).then(resolve, reject);
  }
}

class MemoryDatabase {
  user: Record<string, unknown> | undefined;
  sessionRows: Record<string, unknown>[] = [];
  fileRows: Array<Record<string, any>> = [];
  failFileDelete = false;
  select(projection?: Record<string, unknown>) { return new Query(this, projection); }
  insert(table: unknown) { return new Insert(this, table); }
  delete(table: unknown) { return new Delete(this, table); }
  execute() { return Promise.resolve({ rows: [] }); }
  async transaction<T>(callback: (transaction: this) => Promise<T>) {
    const filesBefore = [...this.fileRows];
    const sessionsBefore = [...this.sessionRows];
    try { return await callback(this); }
    catch (error) {
      this.fileRows = filesBefore;
      this.sessionRows = sessionsBefore;
      throw error;
    }
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
function multipartBody(bytes: Buffer, filename: string) {
  const boundary = `jdrive-${randomUUID()}`;
  const crlf = String.fromCharCode(13, 10);
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="${filename}"${crlf}Content-Type: application/octet-stream${crlf}${crlf}`),
    bytes,
    Buffer.from(`${crlf}--${boundary}--${crlf}`),
  ]);
  return { boundary, payload };
}
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

test('authenticated file flow: login, upload, list/search, storage, streamed download and delete', async () => {
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'arthur', password } });
  assert.equal(login.statusCode, 200);
  assert.deepEqual(login.json().user.username, 'arthur');
  const setCookie = login.headers['set-cookie'];
  cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie as string).split(';', 1)[0];
  assert.match(cookie, /^jdrive_session=[A-Za-z0-9_-]+$/);
  assert.equal(JSON.stringify(db.sessionRows).includes(cookie.split('=')[1]), false, 'raw session token must not be stored');

  const bytes = Buffer.from('private file bytes');
  const { boundary, payload } = multipartBody(bytes, 'notes é.txt');
  const upload = await app.inject({
    method: 'POST', url: '/api/files', headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload,
  });
  assert.equal(upload.statusCode, 201, upload.body);
  const uploaded = upload.json().files[0];
  assert.equal(uploaded.originalName, 'notes é.txt');
  assert.equal(uploaded.sizeBytes, bytes.length);
  assert.equal(uploaded.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.match(uploaded.storageKey, /^[0-9a-f-]{36}$/i);
  const crlf = String.fromCharCode(13, 10);
  const synthetic = { id: randomUUID(), storageKey: randomUUID(), originalName: 'capacity-reservation', mimeType: null, sizeBytes: 2_000_000, sha256: '0'.repeat(64), metadata: {}, createdAt: new Date() };
  db.fileRows.push(synthetic);
  const tooLargeBoundary = `jdrive-${randomUUID()}`;
  const tooLargePayload = Buffer.concat([
    Buffer.from(`--${tooLargeBoundary}${crlf}Content-Disposition: form-data; name="file"; filename="over-capacity.bin"${crlf}Content-Type: application/octet-stream${crlf}${crlf}`),
    Buffer.alloc(1_500_000),
    Buffer.from(`${crlf}--${tooLargeBoundary}--${crlf}`),
  ]);
  const capacityResponse = await app.inject({ method: 'POST', url: '/api/files', headers: { cookie, 'content-type': `multipart/form-data; boundary=${tooLargeBoundary}` }, payload: tooLargePayload });
  db.fileRows = db.fileRows.filter((row) => row.id !== synthetic.id);
  assert.equal(capacityResponse.statusCode, 413);
  assert.equal(capacityResponse.json().error.code, 'STORAGE_LIMIT_EXCEEDED');
  assert.equal(db.fileRows.length, 1, 'rejected upload must not persist metadata');

  const sizeBoundary = `jdrive-${randomUUID()}`;
  const sizePayload = Buffer.concat([
    Buffer.from(`--${sizeBoundary}${crlf}Content-Disposition: form-data; name="file"; filename="over-size.bin"${crlf}Content-Type: application/octet-stream${crlf}${crlf}`),
    Buffer.alloc(2 * 1024 * 1024 + 1),
    Buffer.from(`${crlf}--${sizeBoundary}--${crlf}`),
  ]);
  const sizeResponse = await app.inject({ method: 'POST', url: '/api/files', headers: { cookie, 'content-type': `multipart/form-data; boundary=${sizeBoundary}` }, payload: sizePayload });
  assert.equal(sizeResponse.statusCode, 413);
  assert.equal(sizeResponse.json().error.code, 'FILE_TOO_LARGE');
  assert.equal(db.fileRows.length, 1, 'oversized upload must not persist metadata');
  assert.deepEqual(await readdir(storageConfig.uploadTmpDir), [], 'failed uploads must remove partial temporary files');

  const storedPath = resolveStoragePath(uploaded.storageKey);
  assert.deepEqual(await readFile(storedPath), bytes);
  const pendingDeletePath = path.join(storageConfig.filesDir, `.delete-${uploaded.storageKey}`);
  await rename(storedPath, pendingDeletePath);
  await reconcilePendingDeletions(db as never);
  assert.deepEqual(await readFile(storedPath), bytes, 'startup recovery restores files whose metadata remains');

  const list = await app.inject({ method: 'GET', url: '/api/files?search=NOTES&limit=10&offset=0', headers: { cookie } });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().files[0].id, uploaded.id);
  assert.equal(list.json().limit, 10);
  assert.equal(list.json().offset, 0);
  assert.equal(list.json().total, 1);
  const invalidPage = await app.inject({ method: 'GET', url: '/api/files?limit=0', headers: { cookie } });
  assert.equal(invalidPage.statusCode, 400);
  assert.equal(invalidPage.json().error.code, 'INVALID_PAGINATION');
  const tooManyRows = await app.inject({ method: 'GET', url: '/api/files?limit=101', headers: { cookie } });
  assert.equal(tooManyRows.statusCode, 400);
  assert.equal(tooManyRows.json().error.code, 'INVALID_PAGINATION');
  const defaultPage = await app.inject({ method: 'GET', url: '/api/files', headers: { cookie } });
  assert.equal(defaultPage.json().limit, 50);
  assert.equal(defaultPage.json().offset, 0);
  const usage = await app.inject({ method: 'GET', url: '/api/storage', headers: { cookie } });
  assert.equal(usage.statusCode, 200);
  assert.equal(usage.json().usedBytes, bytes.length);
  assert.equal(usage.json().maxBytes, Math.floor(0.003 * 1024 ** 3));

  const download = await app.inject({ method: 'GET', url: `/api/files/${uploaded.id}/download`, headers: { cookie } });
  assert.equal(download.statusCode, 200);
  assert.equal(download.body, bytes.toString());
  assert.equal(download.headers['content-length'], String(bytes.length));
  assert.match(download.headers['content-disposition'] as string, /attachment/);
  assert.match(download.headers['content-disposition'] as string, /filename\*=UTF-8''/);

  db.failFileDelete = true;
  const failedDeletion = await app.inject({ method: 'DELETE', url: `/api/files/${uploaded.id}`, headers: { cookie } });
  assert.equal(failedDeletion.statusCode, 500);
  assert.equal(db.fileRows.length, 1, 'failed database deletion must preserve metadata');
  assert.deepEqual(await readFile(storedPath), bytes, 'failed database deletion must restore the file');

  const deletion = await app.inject({ method: 'DELETE', url: `/api/files/${uploaded.id}`, headers: { cookie } });
  assert.equal(deletion.statusCode, 204);
  assert.equal(db.fileRows.length, 0);
  await assert.rejects(access(storedPath));
  const emptyList = await app.inject({ method: 'GET', url: '/api/files', headers: { cookie } });
  assert.equal(emptyList.json().total, 0);
  assert.equal(emptyList.json().files.length, 0);
  const usageAfterDelete = await app.inject({ method: 'GET', url: '/api/storage', headers: { cookie } });
  assert.equal(usageAfterDelete.json().usedBytes, 0);
  const orphanKey = randomUUID();
  const orphanTrashPath = path.join(storageConfig.filesDir, `.delete-${orphanKey}`);
  await writeFile(orphanTrashPath, bytes);
  await reconcilePendingDeletions(db as never);
  assert.deepEqual(await readFile(resolveStoragePath(orphanKey)), bytes, 'startup recovery preserves an untracked deletion marker');
  const recovered = db.fileRows.find((file) => file.storageKey === orphanKey);
  assert.equal(recovered?.originalName, `recovered-${orphanKey}`);
  assert.equal(recovered?.sha256, createHash('sha256').update(bytes).digest('hex'));
  const orphanUploadKey = randomUUID();
  const orphanUploadPath = resolveStoragePath(orphanUploadKey);
  await writeFile(orphanUploadPath, bytes);
  await reconcilePendingDeletions(db as never);
  assert.deepEqual(await readFile(orphanUploadPath), bytes, 'startup recovery preserves a finalized upload without metadata');
  const recoveredUpload = db.fileRows.find((file) => file.storageKey === orphanUploadKey);
  assert.equal(recoveredUpload?.originalName, `recovered-${orphanUploadKey}`);
  assert.equal(recoveredUpload?.sha256, createHash('sha256').update(bytes).digest('hex'));
  const recoveredUsage = await app.inject({ method: 'GET', url: '/api/storage', headers: { cookie } });
  assert.equal(recoveredUsage.json().usedBytes, bytes.length * 2);
});

test('invalid password cannot create an authenticated session', async () => {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'arthur', password: 'wrong-password' } });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'INVALID_CREDENTIALS');
  assert.equal(db.sessionRows.length, 1);
});

test('logout invalidates the session cookie and blocks subsequent private requests', async () => {
  const response = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
  assert.equal(response.statusCode, 204);
  assert.equal(db.sessionRows.length, 0);
  const privateRequest = await app.inject({ method: 'GET', url: '/api/files', headers: { cookie } });
  assert.equal(privateRequest.statusCode, 401);
});
