import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLatestRequest } from '../src/file-utils.js';
import { shouldApplyRefreshError } from '../src/refresh-state.js';

test('a stale combined refresh cannot clear a newer search error', () => {
  const requests = createLatestRequest();
  const refreshRequest = requests.current();
  const searchRequest = requests.begin();
  assert.equal(shouldApplyRefreshError(requests, refreshRequest), false);
  assert.equal(shouldApplyRefreshError(requests, searchRequest), true);
});

test('refresh does not invalidate a user search that is still active', () => {
  const requests = createLatestRequest();
  const activeSearch = requests.begin();
  const refreshRequest = requests.current();
  assert.equal(refreshRequest, activeSearch);
  assert.equal(requests.isCurrent(activeSearch), true);
});
