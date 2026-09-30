import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/app.js';

const app = buildServer();
after(async () => app.close());

test('health endpoint returns operational status without sensitive data', async () => {
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
});
