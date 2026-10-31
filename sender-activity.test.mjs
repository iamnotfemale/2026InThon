import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createSenderActivities } from './sender-activity.mjs';

function fixture(sendAction) {
  const actions = []; const timers = new Map(); let failures = 0; let next = 0;
  const begin = createSenderActivities({ sendAction: async (id, action, token) => {
    actions.push([id, action, token]); if (sendAction) await sendAction(action);
  }, onFailure: () => { failures++; },
  setTimer: (fn, ms) => { assert.equal(ms, 15000); timers.set(++next, fn); return next; }, clearTimer: id => timers.delete(id) });
  return { begin, actions, timers, failures: () => failures };
}

test('marks seen, refreshes typing only during work and stops once with no leftover timer', async () => {
  const f = fixture(); const activity = f.begin('123', 'token'); await setImmediate();
  assert.deepEqual(f.actions.map(a => a[1]), ['mark_seen', 'typing_on']); assert.equal(f.timers.size, 1);
  [...f.timers.values()][0](); await setImmediate();
  assert.equal(f.actions.at(-1)[1], 'typing_on'); assert.equal(f.timers.size, 1);
  await activity.typing(); // An acknowledgement was sent and the remaining AI work needs typing again.
  await activity.finish(); await activity.finish();
  assert.equal(f.actions.at(-1)[1], 'typing_off'); assert.equal(f.actions.filter(a => a[1] === 'typing_off').length, 1);
  assert.equal(f.timers.size, 0);
});

test('overlapping messages share typing; one reply cannot switch off another ongoing reply', async () => {
  const f = fixture(); const a = f.begin('123', 'old'); const b = f.begin('123', 'fresh');
  await setImmediate(); assert.equal(f.actions.filter(a => a[1] === 'typing_on').length, 1);
  await a.finish(); assert.equal(f.actions.filter(a => a[1] === 'typing_off').length, 0);
  await b.finish(); assert.equal(f.actions.at(-1)[1], 'typing_off'); assert.equal(f.timers.size, 0);
  assert.equal(f.actions.at(-1)[2], 'fresh');
});

test('failed sender actions do not throw or loop, and a new message can try again', async () => {
  const f = fixture(async () => { throw new Error('provider failed with secret'); });
  const a = f.begin('123', 'token'); await setImmediate(); await a.finish();
  assert.equal(f.failures(), 2); assert.equal(f.timers.size, 0);
  assert.deepEqual(f.actions.map(a => a[1]), ['mark_seen', 'typing_on']);
  const b = f.begin('123', 'token'); await setImmediate(); await b.finish(); assert.equal(f.failures(), 4);
});

test('finishing while typing_on is in flight waits for it then clears the indicator', async () => {
  let release;
  const f = fixture(action => action === 'typing_on' ? new Promise(resolve => { release = resolve; }) : undefined);
  const activity = f.begin('123', 'token'); await setImmediate();
  const finishing = activity.finish(); release(); await finishing;
  assert.deepEqual(f.actions.map(a => a[1]), ['mark_seen', 'typing_on', 'typing_off']); assert.equal(f.timers.size, 0);
});
