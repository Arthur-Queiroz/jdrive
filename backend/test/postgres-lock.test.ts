import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createDatabase } from '../src/db/client.js';
import { files, sessions, users } from '../src/db/schema.js';

process.env.FILES_DIR = '.test-data-postgres-lock/files';
process.env.TMP_DIR = '.test-data-postgres-lock/tmp';

const [{ buildServer }, { bootstrapInitialUser }, { initializeStorage, storageConfig, resolveStoragePath }] = await Promise.all([
  import('../src/app.js'),
  import('../src/auth.js'),
  import('../src/storage/config.js'),
]);

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const enabled = process.env.ALLOW_DESTRUCTIVE_TEST_DB === '1';

function multipart(filename: string, bytes: Buffer) {
  const boundary = `jdrive-${randomUUID()}`;
  const crlf = String.fromCharCode(13, 10);
  return {
    boundary,
    body: Buffer.concat([
      Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="${filename}"${crlf}Content-Type: application/octet-stream${crlf}${crlf}`),
      bytes,
      Buffer.from(`${crlf}--${boundary}--${crlf}`),
    ]),
  };
}

test('PostgreSQL advisory lock prevents concurrent uploads from exceeding the storage quota', {
  skip: !testDatabaseUrl || !enabled,
  concurrency: false,
}, async () => {
  assert.ok(testDatabaseUrl);
  const database = createDatabase(testDatabaseUrl);
  const previous = {
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_INITIAL_PASSWORD,
    sessionSecret: process.env.SESSION_SECRET,
    nodeEnv: process.env.NODE_ENV,
  };
  let app: ReturnType<typeof buildServer> | undefined;
  try {
    process.env.ADMIN_USERNAME = 'jdrive-quota-integration';
    process.env.ADMIN_INITIAL_PASSWORD = `test-${randomUUID()}-long-enough`;
    process.env.SESSION_SECRET = `test-session-${randomUUID()}-long-enough`;
    process.env.NODE_ENV = 'test';
    await database.db.delete(sessions);
    await database.db.delete(files);
    await database.db.delete(users);
    await bootstrapInitialUser(database.db);
    await initializeStorage();
    app = buildServer({ database, logger: false });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_INITIAL_PASSWORD },
    });
    assert.equal(login.statusCode, 200);
    const setCookie = login.headers['set-cookie'];
    assert.ok(setCookie);
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';', 1)[0];

    const capacity = storageConfig.maxStorageBytes;
    const reservationKey = randomUUID();
    await database.db.insert(files).values({
      originalName: 'quota-reservation', storageKey: reservationKey, mimeType: null,
      sizeBytes: capacity - 75, sha256: 'c'.repeat(64),
    });

    const first = multipart('first.bin', Buffer.alloc(50, 1));
    const second = multipart('second.bin', Buffer.alloc(50, 2));
    const responses = await Promise.all([first, second].map(({ boundary, body }) => app!.inject({
      method: 'POST', url: '/api/files', headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
    })));

    assert.deepEqual(responses.map((response) => response.statusCode).sort((a, b) => a - b), [201, 413]);
    const rejected = responses.find((response) => response.statusCode === 413);
    assert.equal(rejected?.json().error.code, 'STORAGE_LIMIT_EXCEEDED');
    const records = await database.db.select().from(files);
    const persisted = records.filter((file) => file.storageKey !== reservationKey);
    assert.equal(persisted.length, 1);
    assert.ok((await readFile(resolveStoragePath(persisted[0].storageKey))).length === 50);
    const total = capacity - 75 + persisted[0].sizeBytes;
    assert.ok(total <= capacity, 'stored bytes must not exceed configured quota');
  } finally {
    try {
      await app?.close();
      await database.db.delete(sessions);
      await database.db.delete(files);
      await database.db.delete(users);
    } finally {
      await Promise.all([database.pool.end(), database.lockPool.end()]);
      await rm(path.resolve(storageConfig.filesDir, '..'), { recursive: true, force: true });
      if (previous.username === undefined) delete process.env.ADMIN_USERNAME;
      else process.env.ADMIN_USERNAME = previous.username;
      if (previous.password === undefined) delete process.env.ADMIN_INITIAL_PASSWORD;
      else process.env.ADMIN_INITIAL_PASSWORD = previous.password;
      if (previous.sessionSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = previous.sessionSecret;
      if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous.nodeEnv;
    }
  }
});
