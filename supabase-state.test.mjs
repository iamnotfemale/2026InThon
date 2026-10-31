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

test('recent chat results use the verified sender filter, successful rows and a bounded newest-first query', async () => {
  const requests = [];
  const state = createSupabaseState({ url: 'https://x.supabase.co', key: 'sb_secret_private', fetchImpl: async (url, init) => {
    requests.push({ url: new URL(url), init });
    return Response.json([{ igsid: '123', id: 51, status: 'done', claim: '내 결과' },
      { igsid: '456', id: 52, status: 'done', claim: '다른 사람 결과' }, { igsid: '123', id: 53, status: 'failed' },
      { igsid: '123', id: -1, status: 'done' }]);
  } });
  assert.deepEqual(await state.recentResults('123'), [{ id: 51, status: 'done', claim: '내 결과' }]);
  const { url, init } = requests[0];
  assert.equal(init.method, 'GET'); assert.equal(init.body, undefined);
  assert.equal(url.searchParams.get('igsid'), 'eq.123'); assert.equal(url.searchParams.get('status'), 'eq.done');
  assert.equal(url.searchParams.get('limit'), '3'); assert.equal(url.searchParams.get('order'), 'created_at.desc,id.desc');
  assert.match(url.searchParams.get('select'), /reason.*restaurants.*restaurant_menus/);
  await assert.rejects(state.recentResults('123&igsid=eq.456'), /Invalid sender/);
  assert.equal(requests.length, 1);
});

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

  const before = calls.length;
  for (const status of ['failed', 'no_input', 'not_checkable', 'unexpected']) {
    assert.equal(await state.saveFactCheck('123', { status, messages: ['x'] }), null);
  }
  assert.equal(calls.length, before, 'unprocessed content is never inserted');

  await assert.rejects(state.trackSender('../1'), /Invalid sender id/);
  await assert.rejects(state.saveFactCheck('abc', {}), /Invalid sender id/);
});

test('trackSender reports the stored handle; lookup outcomes store the handle or sanitized error codes', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body) });
    return init.method === 'POST' ? new Response('[{"username":"tester.one"}]', { status: 201 }) : new Response(null, { status: 204 });
  };
  const at = '2026-10-31T00:00:00.000Z';
  const state = createSupabaseState({ url: 'https://x.supabase.co', key: 'sb_secret_test', fetchImpl, now: () => Date.parse(at) });
  assert.deepEqual(await state.trackSender('123'), { username: 'tester.one' });

  await state.recordUsernameLookup('123', { username: 'new.handle' });
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[1].url, 'https://x.supabase.co/rest/v1/ig_accounts?igsid=eq.123');
  assert.deepEqual(calls[1].body, { username: 'new.handle', username_lookup_error: null, username_checked_at: at });

  await state.recordUsernameLookup('123', { error: 'HTTP 400, code 100, subcode 33, GraphMethodException' });
  assert.deepEqual(calls[2].body, { username_lookup_error: 'HTTP 400, code 100, subcode 33, GraphMethodException', username_checked_at: at });

  // Invalid handles are treated as failures, and stray characters are stripped from stored errors.
  await state.recordUsernameLookup('123', { username: 'bad name', error: 'x<script>"y"' });
  assert.deepEqual(calls[3].body, { username_lookup_error: 'xscripty', username_checked_at: at });
  await state.recordUsernameLookup('123', {});
  assert.equal(calls[4].body.username_lookup_error, 'unknown');

  await assert.rejects(state.recordUsernameLookup('1&x=1', { username: 'ok' }), /Invalid sender id/);
  assert.equal(calls.length, 5);
});

test('saveFactCheck returns the new row id and markFactCheckSent flags only valid ids', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, prefer: init.headers.Prefer, body: JSON.parse(init.body) });
    return init.method === 'POST' ? new Response('[{"id":42}]', { status: 201 }) : new Response(null, { status: 204 });
  };
  const at = '2026-10-31T00:00:00.000Z';
  const state = createSupabaseState({ url: 'https://x.supabase.co', key: 'sb_secret_test', fetchImpl, now: () => Date.parse(at) });
  assert.deepEqual(await state.saveFactCheck('123', { status: 'done', verdict: 'supported' }), { id: 42 });
  assert.equal(calls[0].url, 'https://x.supabase.co/rest/v1/factchecks?select=id');
  assert.equal(calls[0].prefer, 'return=representation');
  await state.markFactCheckSent(42);
  assert.equal(calls[1].url, 'https://x.supabase.co/rest/v1/factchecks?id=eq.42');
  assert.deepEqual(calls[1].body, { dm_status: 'sent', dm_sent_at: at });
  for (const bad of [0, -1, 1.5, '42', null]) await assert.rejects(state.markFactCheckSent(bad), /Invalid fact-check id/);
  assert.equal(calls.length, 2);
});
