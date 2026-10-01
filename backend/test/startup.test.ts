import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForDatabase } from '../src/startup.js';

test('waits for a transient database connection before starting', async () => {
  let attempts = 0;
  await waitForDatabase(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('connection unavailable');
  }, { attempts: 3, delayMs: 1, sleep: async () => undefined });
  assert.equal(attempts, 3);
});

test('fails after the configured database connection attempts', async () => {
  let attempts = 0;
  await assert.rejects(
    waitForDatabase(async () => {
      attempts += 1;
      throw new Error('connection unavailable');
    }, { attempts: 2, delayMs: 1, sleep: async () => undefined }),
    /connection unavailable/,
  );
  assert.equal(attempts, 2);
});
