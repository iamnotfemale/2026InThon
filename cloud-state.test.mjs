import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudState } from './cloud-state.mjs';

test('cloud reservation is shared between instances and stores only hashes and metadata', async () => {
  const objects = new Map();
  const put = async (path, body, options) => {
    assert.equal(options.access, 'private');
    assert.equal(options.allowOverwrite, false);
    assert.equal(options.addRandomSuffix, false);
    if (objects.has(path)) throw new Error('already exists');
    objects.set(path, body);
  };
  const key = 'a'.repeat(64);
  const head = async path => { if (!objects.has(path)) throw new Error('missing'); };
  const a = createCloudState(put, head); const b = createCloudState(put, head);
  assert.deepEqual(await Promise.all([a.reserveReply(key), b.reserveReply(key)]), [true, false]);
  await a.replyRecord({ key, status: 'sent', at: '2026-10-31T00:00:00Z' });
  await a.record({ receivedAt: '2026-10-31T00:00:00Z', messages: 1, entries: 1 });
  assert.equal(objects.size, 3);
  for (const value of objects.values()) assert.doesNotMatch(value, /sender|recipient|token|message_id/);
});

test('cloud storage errors fail closed and invalid keys are rejected', async () => {
  const state = createCloudState(async () => { throw new Error('storage unavailable'); }, async () => { throw new Error('missing'); });
  await assert.rejects(state.reserveReply('a'.repeat(64)), /storage unavailable/);
  await assert.rejects(state.reserveReply('../invalid'), /Invalid reply key/);
});
