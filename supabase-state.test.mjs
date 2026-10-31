import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseState } from './supabase-state.mjs';

// Minimal in-memory stand-in for PostgREST with a primary key on dm_replies.key.
function fakeSupabase() {
  const receipts = []; const replies = new Map(); const calls = [];
  const reply = (status, body) => new Response(body ? JSON.stringify(body) : null, { status });
  const fetchImpl = async (url, init) => {
    const { pathname, searchParams } = new URL(url);
    const body = JSON.parse(init.body);
    calls.push({ method: init.method, pathname, headers: init.headers, body });
    if (init.method === 'POST' && pathname === '/rest/v1/dm_receipts') { receipts.push(body); return reply(201); }
    if (init.method === 'POST' && pathname === '/rest/v1/dm_replies') {
      if (replies.has(body.key)) return reply(409, { code: '23505', message: 'duplicate key' });
      replies.set(body.key, body); return reply(201);
    }
    if (init.method === 'PATCH' && pathname === '/rest/v1/dm_replies') {
      const key = searchParams.get('key').replace(/^eq\./, '');
      Object.assign(replies.get(key), body); return reply(204);
    }
    return reply(404);
  };
  return { fetchImpl, receipts, replies, calls };
}

test('supabase reservation lets exactly one instance reply and stores only hashes and metadata', async () => {
  const db = fakeSupabase();
  const opts = { url: 'https://example.supabase.co/', key: 'sb_secret_test', fetchImpl: db.fetchImpl };
  const a = createSupabaseState(opts); const b = createSupabaseState(opts);
  const key = 'a'.repeat(64);
  assert.deepEqual(await Promise.all([a.reserveReply(key), b.reserveReply(key)]), [true, false]);
  await a.replyRecord({ key, status: 'sent', at: '2026-10-31T00:00:00Z' });
  await a.record({ receivedAt: '2026-10-31T00:00:00Z', messages: 1, entries: 1 });
  assert.equal(db.replies.get(key).status, 'sent');
  assert.equal(db.replies.get(key).sent_at, '2026-10-31T00:00:00Z');
  assert.deepEqual(db.receipts, [{ received_at: '2026-10-31T00:00:00Z', messages: 1, entries: 1 }]);
  for (const { body } of db.calls) assert.doesNotMatch(JSON.stringify(body), /sender|recipient|token|message_id/);
});

test('secret keys go only in apikey; legacy service_role JWTs also use Authorization', async () => {
  const db = fakeSupabase();
  await createSupabaseState({ url: 'https://x.supabase.co', key: 'sb_secret_test', fetchImpl: db.fetchImpl })
    .record({ receivedAt: 't', messages: 0, entries: 0 });
  await createSupabaseState({ url: 'https://x.supabase.co', key: 'eyJlegacy', fetchImpl: db.fetchImpl })
    .record({ receivedAt: 't', messages: 0, entries: 0 });
  assert.equal(db.calls[0].headers.apikey, 'sb_secret_test');
  assert.equal(db.calls[0].headers.Authorization, undefined);
  assert.equal(db.calls[1].headers.Authorization, 'Bearer eyJlegacy');
});

test('supabase errors fail closed without leaking the key, and invalid input is rejected', async () => {
  const state = createSupabaseState({ url: 'https://x.supabase.co', key: 'sb_secret_hidden',
    fetchImpl: async () => new Response(JSON.stringify({ code: 'PGRST301' }), { status: 401 }) });
  await assert.rejects(state.reserveReply('a'.repeat(64)), error => {
    assert.match(error.message, /failed \(401 PGRST301\)/);
    assert.doesNotMatch(error.message, /sb_secret_hidden/);
    return true;
  });
  await assert.rejects(state.record({ receivedAt: 't', messages: 0, entries: 0 }), /401/);
  await assert.rejects(state.reserveReply('../invalid'), /Invalid reply key/);
  await assert.rejects(state.replyRecord({ key: 'a'.repeat(64), status: 'failed', at: 't' }), /Unsupported/);
  assert.throws(() => createSupabaseState({ url: '', key: 'k' }), /required/);
});
