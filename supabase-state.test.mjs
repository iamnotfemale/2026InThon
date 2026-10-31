import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

test('senders are upserted, link tokens store only a hash with a 10-minute expiry, and fact-checks keep no DM text', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, ...init, body: JSON.parse(init.body) }); return init.headers.Prefer.includes("return=representation") ? new Response("[{\"username\":null}]", { status: 201 }) : new Response(null, { status: 201 }); };
  const state = createSupabaseState({ url: 'https://x.supabase.co', key: 'sb_secret_test', fetchImpl, now: () => Date.parse('2026-10-31T00:00:00Z') });

  await state.trackSender('123');
  assert.equal(calls[0].url, 'https://x.supabase.co/rest/v1/ig_accounts?on_conflict=igsid&select=username');
  assert.equal(calls[0].headers.Prefer, 'return=representation,resolution=merge-duplicates');
  assert.deepEqual(calls[0].body, { igsid: '123', last_seen_at: '2026-10-31T00:00:00.000Z' });

  const token = await state.issueLinkToken({ igsid: '123', username: 'tester.one' });
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(calls[1].body.username, 'tester.one');
  const tokenRow = calls[2].body;
  assert.equal(tokenRow.token_hash, createHash('sha256').update(token).digest('hex'));
  assert.equal(tokenRow.expires_at, '2026-10-31T00:10:00.000Z');
  assert.ok(!JSON.stringify(calls).includes(token), 'raw token must never be sent to the database');

  await state.issueLinkToken({ igsid: '123', username: 'bad name<script>' });
  assert.equal(calls[3].body.username, undefined, 'invalid handles are dropped');

  await state.saveFactCheck('123', { status: 'done', verdict: 'refuted', reason: '근거와 다름',
    extracted: { claim: '주장', topic: 'health' }, messages: ['private DM text'],
    cited: [{ url: 'https://example.org/a', title: 't', source: 's', id: 'E1' }, { url: 'javascript:alert(1)', title: 'x' }] });
  const row = calls.at(-1).body;
  assert.deepEqual(row, { igsid: '123', status: 'done', verdict: 'refuted', claim: '주장', topic: 'health', reason: '근거와 다름',
    sources: [{ url: 'https://example.org/a', title: 't', source: 's' }] });

  await state.saveFactCheck('123', { status: 'failed', messages: ['x'] });
  assert.deepEqual(calls.at(-1).body, { igsid: '123', status: 'failed', verdict: null, claim: null, topic: null, reason: null, sources: [] });

  await assert.rejects(state.trackSender('../1'), /Invalid sender id/);
  await assert.rejects(state.saveFactCheck('abc', {}), /Invalid sender id/);
});

test('trackSender reports the stored handle and setUsername fills it in only with a valid handle', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body) });
    return init.method === 'POST' ? new Response('[{"username":"tester.one"}]', { status: 201 }) : new Response(null, { status: 204 });
  };
  const state = createSupabaseState({ url: 'https://x.supabase.co', key: 'sb_secret_test', fetchImpl });
  assert.deepEqual(await state.trackSender('123'), { username: 'tester.one' });
  await state.setUsername('123', 'new.handle');
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[1].url, 'https://x.supabase.co/rest/v1/ig_accounts?igsid=eq.123');
  assert.deepEqual(calls[1].body, { username: 'new.handle' });
  await assert.rejects(state.setUsername('123', 'bad name'), /Invalid username/);
  await assert.rejects(state.setUsername('1&x=1', 'ok'), /Invalid sender id/);
  assert.equal(calls.length, 2);
});
