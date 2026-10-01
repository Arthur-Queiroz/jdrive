import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLatestRequest, fileSearchURL, formatBytes, uploadProgress } from '../src/file-utils.js';

test('formats file sizes without NaN and uses readable units', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(Number.NaN), '0 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1024 ** 3), '1.0 GB');
});

test('computes bounded per-file upload progress', () => {
  assert.equal(uploadProgress(0, 0), 0);
  assert.equal(uploadProgress(25, 100), 25);
  assert.equal(uploadProgress(100, 100), 99);
  assert.equal(uploadProgress(200, 100), 99);
});

test('encodes a trimmed file search query', () => {
  assert.equal(fileSearchURL('  holiday photo  '), '/files?search=holiday%20photo');
  assert.equal(fileSearchURL('   '), '/files');
});

test('only the latest search response may update results', () => {
  const latest = createLatestRequest();
  const older = latest.begin();
  const newer = latest.begin();
  assert.equal(latest.isCurrent(newer), true);
  assert.equal(latest.isCurrent(older), false);
});
