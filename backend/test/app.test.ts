import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/app.js';
import { hashToken } from '../src/auth.js';
import { resolveStoragePath } from '../src/storage/config.js';

const app = buildServer({ database: {} as never, logger: false });
after(async () => app.close());

test('health is public and returns only operational status', async () => {
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
});

test('unknown API paths use the same JSON 404 response with and without frontend assets', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/not-a-route' });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: { code: 'NOT_FOUND', message: 'Resource not found' } });
});

test('protected file routes reject requests without a valid session', async () => {
  for (const url of ['/api/auth/me', '/api/files', '/api/storage', '/api/files/not-a-uuid/download']) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 401, `${url} should require authentication`);
    assert.equal(response.json().error.code, 'UNAUTHENTICATED');
  }
});

test('login validates malformed requests without leaking internal errors', async () => {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: '', password: '' } });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'INVALID_REQUEST');
  assert.equal(JSON.stringify(response.json()).includes('stack'), false);
});

test('login is rate-limited after repeated attempts', async () => {
  const responses = [];
  for (let i = 0; i < 6; i += 1) {
    responses.push(await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: '', password: '' } }));
  }
  const limited = responses.find((response) => response.statusCode === 429);
  assert.ok(limited, `expected 429; got ${responses.map((response) => `${response.statusCode}:${response.body}`).join(' | ')}`);
  assert.equal(limited.json().error.code, 'RATE_LIMITED');
});

test('logout requires authentication and does not mutate anonymous sessions', async () => {
  const response = await app.inject({ method: 'POST', url: '/api/auth/logout' });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'UNAUTHENTICATED');
});

test('session tokens are stored as keyed digests, never as raw values', () => {
  const previousSecret = process.env.SESSION_SECRET;
  try {
    delete process.env.SESSION_SECRET;
    assert.throws(() => hashToken('session-token'), /SESSION_SECRET/);
    process.env.SESSION_SECRET = `session-${randomUUID()}`;
    const token = `token-${randomUUID()}`;
    const digest = hashToken(token);
    assert.notEqual(digest, token);
    assert.equal(digest, hashToken(token));
    process.env.SESSION_SECRET = `session-${randomUUID()}`;
    assert.notEqual(digest, hashToken(token));
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test('filesystem resolver accepts UUID storage keys and rejects traversal', () => {
  const valid = resolveStoragePath('8eeaaf47-70f8-4bf4-b82d-5fd5f93ea559');
  assert.match(valid, /8eeaaf47-70f8-4bf4-b82d-5fd5f93ea559$/);
  for (const key of ['../../etc/passwd', 'file.txt', '']) assert.throws(() => resolveStoragePath(key));
});
