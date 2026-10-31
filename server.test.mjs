import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, appendFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServers, readReplyKeys, SCOPES, FACTCHECK_ACK, FACTCHECK_FAILED, LINK_FAILED, linkMessage } from './server.mjs';
import { readSecrets, writeSecrets } from './secrets.mjs';

async function fixture(t, options = {}) {
  const config = { publicUrl: 'https://example.ngrok-free.dev', verifyToken: 'test-verification',
    appSecret: 'a'.repeat(32), webhookSecret: 'a'.repeat(32), ...options.config };
  const saved = []; const receipts = [];
  const { config: ignored, ...serverOptions } = options;
  const servers = createServers({ config, persist: value => saved.push(value), record: value => receipts.push(value), ...serverOptions });
  for (const server of [servers.publicServer, servers.adminServer]) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); }
  t.after(() => Promise.all([servers.publicServer, servers.adminServer].map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }))));
  const publicUrl = `http://127.0.0.1:${servers.publicServer.address().port}`;
  const adminUrl = `http://127.0.0.1:${servers.adminServer.address().port}`;
  const html = await (await fetch(adminUrl)).text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)[1];
  const post = (path, values = {}) => fetch(adminUrl + path, { method: 'POST', redirect: 'manual',
    headers: { Origin: adminUrl, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf, ...values }) });
  const sign = raw => 'sha256=' + createHmac('sha256', config.webhookSecret).update(raw).digest('hex');
  return { ...servers, config, saved, receipts, publicUrl, adminUrl, html, post, sign };
}
async function begin(f) {
  const launch = await f.post('/login'); assert.equal(launch.status, 303);
  const location = new URL(launch.headers.get('location'));
  const response = await fetch(f.publicUrl + location.pathname + location.search, { redirect: 'manual' });
  assert.equal(response.status, 303);
  return { auth: new URL(response.headers.get('location')), cookie: response.headers.get('set-cookie').split(';')[0], start: location };
}
const json = data => new Response(JSON.stringify(data), { status: 200 });
const IG_ID = '17841414630453998';
const incoming = (overrides = {}) => ({ sender: { id: '123456789' }, recipient: { id: IG_ID },
  timestamp: Date.now(), message: { mid: 'private-message-id', text: 'private-message-body' }, ...overrides });
async function deliver(f, events, entryId = IG_ID) {
  const raw = JSON.stringify({ object: 'instagram', entry: [{ id: entryId, messaging: events }] });
  return fetch(f.publicUrl + '/webhooks/instagram', { method: 'POST', body: raw, headers: { 'X-Hub-Signature-256': f.sign(raw) } });
}
async function eventually(predicate) {
  // Up to 2 s: parallel test files (e.g. the DPAPI PowerShell spawn) can delay background replies.
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.ok(predicate(), 'Expected asynchronous reply result');
}

test('optional media diagnostics only observe verified events and do not delay acknowledgement or break replies', async t => {
  let observed = 0; let release;
  const f = await fixture(t, { observeMessages: async messages => {
    observed++;
    assert.equal(messages[0].event.message.attachments[0].type, 'ig_post');
    await new Promise(resolve => { release = resolve; });
    throw new Error('diagnostic unavailable');
  } });
  const unsigned = await fetch(f.publicUrl + '/webhooks/instagram', { method: 'POST', body: '{}' });
  assert.equal(unsigned.status, 403); assert.equal(observed, 0);
  const r = await deliver(f, [incoming({ message: { mid: 'media-test', attachments: [{ type: 'ig_post' }] } })]);
  assert.equal(r.status, 200);
  await eventually(() => observed === 1); release();
  assert.equal((await fetch(f.publicUrl + '/health')).status, 200);
});

test('auto reply sends the exact greeting, acknowledges promptly and deduplicates concurrent/restarted deliveries', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'inthon-replies-')); const journal = join(dir, 'replies.jsonl');
  t.after(() => { unlinkSync(journal); rmdirSync(dir); });
  let calls = 0; let release;
  const f = await fixture(t, { config: { accessToken: 'test-token', userId: IG_ID },
    replyRecord: entry => appendFileSync(journal, JSON.stringify(entry) + '\n'),
    apiFetch: async (url, options) => {
      calls++;
      assert.equal(url, `https://graph.facebook.com/v26.0/${IG_ID}/messages`);
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      assert.deepEqual(JSON.parse(options.body), { recipient: { id: '123456789' }, message: { text: '안녕?' } });
      await new Promise(resolve => { release = resolve; });
      return json({ recipient_id: '123456789', message_id: 'outbound-id' });
    } });
  const response = await deliver(f, [incoming()]);
  assert.equal(response.status, 200); assert.equal(calls, 1); assert.equal(f.stats.replies, 0);
  assert.equal((await deliver(f, [incoming()])).status, 200); assert.equal(calls, 1);
  release(); await eventually(() => f.stats.replies === 1);
  const journalText = readFileSync(journal, 'utf8');
  assert.doesNotMatch(journalText, /123456789|private-message|test-token/);
  assert.deepEqual(journalText.trim().split('\n').map(line => JSON.parse(line).status), ['sending', 'sent']);
  const restarted = await fixture(t, { config: { accessToken: 'test-token', userId: IG_ID },
    handledReplies: readReplyKeys(journal), apiFetch: async () => { calls++; return json({ message_id: 'duplicate' }); } });
  await deliver(restarted, [incoming()]);
  assert.equal(calls, 1); assert.equal(restarted.stats.replies, 0);
});
test('auto reply ignores echoes, self-messages, wrong accounts, stale events, missing IDs and non-message events', async t => {
  let calls = 0;
  const f = await fixture(t, { config: { accessToken: 'test-token', userId: IG_ID },
    apiFetch: async () => { calls++; return json({ message_id: 'wrong' }); } });
  await deliver(f, [
    incoming({ message: { mid: 'echo', is_echo: true } }),
    incoming({ sender: { id: IG_ID } }), incoming({ recipient: { id: '999' } }),
    incoming({ message: { text: 'no id' } }), incoming({ sender: { id: 'not-an-id' } }),
    incoming({ timestamp: Date.now() - 86400001 }), incoming({ timestamp: Date.now() + 600000 }),
    incoming({ message: { mid: 'deleted', is_deleted: true } }), { read: { watermark: Date.now() } },
  ]);
  await deliver(f, [incoming()], '999');
  assert.equal(calls, 0); assert.equal(f.stats.replies, 0);
});
test('auto reply handles changes envelopes and reports send failures without leaking or resending', async t => {
  let calls = 0; const journal = [];
  const f = await fixture(t, { config: { accessToken: 'test-token', userId: IG_ID }, replyRecord: entry => journal.push(entry),
    apiFetch: async () => { calls++; return new Response(JSON.stringify({ error: { code: 10, message: 'private-token' } }), { status: 403 }); } });
  const raw = JSON.stringify({ object: 'instagram', entry: [{ id: IG_ID, changes: [{ field: 'messages', value: incoming() }] }] });
  const send = () => fetch(f.publicUrl + '/webhooks/instagram', { method: 'POST', body: raw, headers: { 'X-Hub-Signature-256': f.sign(raw) } });
  assert.equal((await send()).status, 200); await eventually(() => f.stats.replyFailures === 1);
  await send(); assert.equal(calls, 1); assert.equal(journal.length, 1);
  assert.match(f.stats.lastError, /403, code 10/); assert.doesNotMatch(f.stats.lastError, /private-token/);
});
test('auto reply fails closed when its durable reservation cannot be written', async t => {
  let calls = 0;
  const f = await fixture(t, { config: { accessToken: 'test-token', userId: IG_ID },
    replyRecord: () => { throw new Error('disk full'); }, apiFetch: async () => { calls++; return json({ message_id: 'wrong' }); } });
  await deliver(f, [incoming()]); await eventually(() => f.stats.replyFailures === 1);
  assert.equal(calls, 0);
});

test('cloud reservation prevents duplicate sends across concurrent server instances', async t => {
  let reserved = false; let calls = 0;
  const options = { config: { accessToken: 'test-token', userId: IG_ID },
    reserveReply: async () => { if (reserved) return false; reserved = true; return true; },
    apiFetch: async () => { calls++; return json({ message_id: 'cloud-reply' }); } };
  const a = await fixture(t, options); const b = await fixture(t, options);
  await Promise.all([deliver(a, [incoming()]), deliver(b, [incoming()])]);
  await eventually(() => a.stats.replies + b.stats.replies === 1);
  assert.equal(calls, 1);
});

test('failed async receipts are not acknowledged and background replies are registered', async t => {
  const failing = await fixture(t, { record: async () => { throw new Error('cloud down'); } });
  assert.equal((await deliver(failing, [incoming()])).status, 500);
  let background;
  const f = await fixture(t, { config: { accessToken: 'test-token', userId: IG_ID },
    reserveReply: async () => true, background: task => { background = task; },
    apiFetch: async () => json({ message_id: 'cloud-reply' }) });
  assert.equal((await deliver(f, [incoming()])).status, 200);
  assert.ok(background instanceof Promise);
  await background;
  assert.equal(f.stats.replies, 1);
});

test('cloud replies use the refreshed token and fail closed when token loading fails', async t => {
  let calls = 0;
  const f = await fixture(t, { config: { accessToken: 'old-token', userId: IG_ID },
    loadAccessToken: async () => 'fresh-token', apiFetch: async (url, options) => {
      calls++; assert.equal(options.headers.Authorization, 'Bearer fresh-token'); return json({ message_id: 'fresh-reply' });
    } });
  await deliver(f, [incoming()]); await eventually(() => f.stats.replies === 1);
  const failed = await fixture(t, { config: { accessToken: 'old-token', userId: IG_ID },
    loadAccessToken: async () => { throw new Error('storage unavailable'); }, apiFetch: async () => { calls++; return json({}); } });
  await deliver(failed, [incoming()]); await eventually(() => failed.stats.replyFailures === 1);
  assert.equal(calls, 1);
});

test('cloud login launch is CSRF protected and uses a signed operator ticket', async t => {
  const f = await fixture(t);
  const r = await f.post('/cloud-login'); assert.equal(r.status, 303);
  const url = new URL(r.headers.get('location'));
  assert.equal(url.origin, 'https://inthon-pi.vercel.app');
  assert.equal(url.pathname, '/auth/start');
  assert.match(url.searchParams.get('ticket'), /^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/);
  assert.equal((await f.post('/cloud-login', { csrf: 'wrong' })).status, 403);
});

test('webhook verification rejects wrong tokens and echoes the exact challenge', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(`${f.publicUrl}/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=00123`)).status, 403);
  const response = await fetch(`${f.publicUrl}/webhooks/instagram?hub.mode=subscribe&hub.verify_token=test-verification&hub.challenge=00123`);
  assert.equal(response.status, 200); assert.equal(await response.text(), '00123');
  assert.equal(f.stats.verifications, 1);
});
test('raw-body HMAC validation, schema validation, and privacy-preserving receipt', async t => {
  const f = await fixture(t);
  const raw = JSON.stringify({ object: 'instagram', entry: [{ id: '17841414630453998', messaging: [
    { sender: { id: 'private-sender' }, message: { text: '비공개 메시지' } }, { message: { is_echo: true, text: 'echo' } },
  ] }] });
  const send = (payload, signature) => fetch(f.publicUrl + '/webhooks/instagram', { method: 'POST', body: payload,
    headers: { 'X-Hub-Signature-256': signature } });
  assert.equal((await send(raw, 'sha256=wrong')).status, 403);
  assert.equal((await send(raw + ' ', f.sign(raw))).status, 403);
  assert.equal((await send('bad-json', f.sign('bad-json'))).status, 400);
  assert.equal((await send('{"object":"instagram","entry":[null]}', f.sign('{"object":"instagram","entry":[null]}'))).status, 400);
  assert.equal((await send(raw, f.sign(raw))).status, 200);
  assert.equal(f.stats.messages, 1); assert.equal(f.receipts.length, 1);
  assert.doesNotMatch(JSON.stringify(f.receipts), /private-sender|비공개/);
});
test('missing signing secret fails closed; failed persistence is not acknowledged', async t => {
  const f = await fixture(t, { config: { webhookSecret: null }, record: () => { throw new Error('disk failed'); } });
  assert.equal((await fetch(f.publicUrl + '/webhooks/instagram', { method: 'POST', body: '{}' })).status, 503);
  f.config.webhookSecret = 's';
  const raw = '{"object":"instagram","entry":[]}';
  assert.equal((await fetch(f.publicUrl + '/webhooks/instagram', { method: 'POST', body: raw,
    headers: { 'X-Hub-Signature-256': f.sign(raw) } })).status, 500);
  assert.equal(f.stats.signedEvents, 0);
});
test('Meta dashboard samples using changes are recognized as message events', async t => {
  const f = await fixture(t);
  const raw = JSON.stringify({ object: 'instagram', entry: [{ changes: [{ field: 'messages', value: { message: { text: 'sample' } } }] }] });
  const r = await fetch(f.publicUrl + '/webhooks/instagram', { method: 'POST', body: raw, headers: { 'X-Hub-Signature-256': f.sign(raw) } });
  assert.equal(r.status, 200); assert.equal(f.stats.messages, 1);
});
test('body limits reject oversize requests', async t => {
  const f = await fixture(t);
  const response = await fetch(f.publicUrl + '/webhooks/instagram', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) });
  assert.equal(response.status, 413);
});
test('public routes expose no admin, files, or credentials; admin enforces Host, Origin, and CSRF', async t => {
  const f = await fixture(t);
  for (const path of ['/', '/config', '/.local/credentials.dpapi']) assert.equal((await fetch(f.publicUrl + path)).status, 404);
  assert.doesNotMatch(f.html, new RegExp('a'.repeat(32)));
  assert.match(f.html, /<details><summary>웹훅 검증 토큰 보기/);
  const hostResponse = await new Promise(resolve => {
    import('node:http').then(({ get }) => get(f.adminUrl, { headers: { Host: 'attacker.example' } }, r => { r.resume(); resolve(r.statusCode); }));
  });
  assert.equal(hostResponse, 403);
  assert.equal((await fetch(f.adminUrl, { headers: { 'X-Forwarded-For': '1.2.3.4' } })).status, 403);
  assert.equal((await fetch(f.adminUrl + '/config', { method: 'POST', body: 'csrf=bad' })).status, 403);
  assert.equal((await f.post('/config', { csrf: 'wrong', appSecret: 'b'.repeat(32) })).status, 403);
  assert.equal((await f.post('/config', { appSecret: 'invalid' })).status, 400);
  const opaque = await fetch(f.adminUrl + '/config', { method: 'POST', redirect: 'manual',
    headers: { Origin: 'null', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ csrf: /name="csrf" value="([^"]+)"/.exec(f.html)[1], appSecret: 'b'.repeat(32) }) });
  assert.equal(opaque.status, 303);
  const untrusted = await fetch(f.adminUrl + '/config', { method: 'POST',
    headers: { Origin: 'null', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf: 'wrong', appSecret: 'b'.repeat(32) }) });
  assert.equal(untrusted.status, 403);
});
test('Unified Login uses the registered config and protects against unsolicited, expired, and replayed callbacks', async t => {
  let clock = Date.now(); const f = await fixture(t, { now: () => clock });
  const { auth, cookie, start } = await begin(f);
  assert.equal(auth.origin, 'https://www.facebook.com');
  assert.equal(auth.searchParams.get('config_id'), '2085773485459248');
  assert.equal(auth.searchParams.has('scope'), false);
  assert.deepEqual(SCOPES, ['instagram_basic', 'instagram_manage_messages']);
  assert.equal((await fetch(f.publicUrl + start.pathname + start.search)).status, 403);
  const callback = f.publicUrl + '/auth/instagram/callback?code=private-code&state=' + auth.searchParams.get('state');
  assert.equal((await fetch(callback)).status, 403);
  clock += 600001;
  assert.equal((await fetch(callback, { headers: { Cookie: cookie } })).status, 403);
});
test('OAuth exchanges code server-side, validates the target account, and stores token plus business ID', async t => {
  let calls = 0;
  const f = await fixture(t, { apiFetch: async (url, options) => {
    calls++;
    const u = new URL(url);
    assert.equal(u.origin, 'https://graph.facebook.com');
    if (u.pathname.endsWith('/oauth/access_token')) {
      assert.equal(u.searchParams.get('redirect_uri'), 'https://example.ngrok-free.dev/auth/instagram/callback');
      assert.equal(u.searchParams.get('client_id'), '2418018855613539');
      assert.equal(u.searchParams.get('code'), 'private-code');
      return json({ access_token: 'private-access-token', expires_in: 3600 });
    }
    assert.equal(options.headers.Authorization, 'Bearer private-access-token');
    if (u.pathname.endsWith('/assigned_instagram_accounts')) return json({ data: [{ id: '17841414630453998', username: 'inthon2team' }] });
    return json({ client_business_id: '1430869132503969' });
  } });
  const { auth, cookie } = await begin(f);
  const callback = f.publicUrl + '/auth/instagram/callback?code=private-code&state=' + auth.searchParams.get('state');
  const response = await fetch(callback, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/auth/result');
  assert.equal(f.saved[0].accessToken, 'private-access-token');
  assert.equal(f.saved[0].businessId, '1430869132503969');
  assert.equal(f.saved[0].userId, '17841414630453998'); assert.equal(f.stats.tokenSaved, true);
  assert.equal(calls, 3);
  assert.equal((await fetch(callback, { headers: { Cookie: cookie } })).status, 403);
  assert.doesNotMatch(await (await fetch(f.adminUrl)).text(), /private-access-token|private-code/);
});
test('wrong Instagram account is never saved, and Meta error text is not leaked', async t => {
  for (const failAtApi of [false, true]) {
    const f = await fixture(t, { apiFetch: async url => {
      if (failAtApi) return new Response(JSON.stringify({ error: { code: 190, message: 'private-secret' } }), { status: 400 });
      return String(url).includes('/oauth/') ? json({ access_token: 'private-token' }) : json({ data: [{ id: 'wrong', username: 'other' }] });
    } });
    const { auth, cookie } = await begin(f);
    await fetch(f.publicUrl + '/auth/instagram/callback?code=c&state=' + auth.searchParams.get('state'), { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(f.saved.length, 0); assert.equal(f.stats.tokenSaved, false);
    assert.doesNotMatch(f.stats.lastError, /private-secret|private-token/);
  }
});
test('the configured target is checked directly when the assigned-accounts list omits it', async t => {
  const f = await fixture(t, { apiFetch: async url => {
    const u = new URL(url);
    if (u.pathname.endsWith('/oauth/access_token')) return json({ access_token: 'private-token' });
    if (u.pathname.endsWith('/assigned_instagram_accounts')) return json({ data: [] });
    if (u.pathname.endsWith('/17841414630453998')) return json({ id: '17841414630453998', username: 'inthon2team' });
    return json({ client_business_id: '1430869132503969' });
  } });
  const {auth,cookie}=await begin(f);
  await fetch(f.publicUrl + '/auth/instagram/callback?code=c&state=' + auth.searchParams.get('state'), { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(f.stats.tokenSaved,true); assert.equal(f.saved[0].userId,'17841414630453998');
});
test('account message subscription is checked for this app and messages field', async t => {
  const f = await fixture(t, { config: { publicUrl: 'https://example.ngrok-free.dev', verifyToken: 'v', appSecret: 'a'.repeat(32), accessToken: 'private-token' },
    apiFetch: async (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer private-token');
      if (String(url).includes('assigned_instagram_accounts')) return json({ data: [{ id: '17841414630453998', username: 'inthon2team' }] });
      if (options.method === 'POST') { assert.equal(options.body.get('subscribed_fields'), 'messages'); return json({ success: true }); }
      return json({ data: [{ subscribed_fields: ['messages'] }] });
    } });
  assert.equal((await f.post('/subscribe')).status, 303);
  assert.equal(f.stats.subscription, 'messages 구독 확인 완료');
});
test('changing app secret invalidates the saved token and pending login requests', async t => {
  const f = await fixture(t); const { start } = await begin(f);
  const response = await f.post('/config', { appSecret: 'b'.repeat(32) });
  assert.equal(response.status, 303); assert.equal(f.saved[0].accessToken, null);
  assert.equal((await fetch(f.publicUrl + start.pathname + start.search)).status, 403);
});
test('DPAPI round-trip is encrypted on disk', { skip: process.platform !== 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'inthon-dpapi-'));
  try {
    const file = join(dir, 'secret'); const value = { accessToken: 'dummy-local-self-test', label: '암호화' };
    writeSecrets(file, value); assert.deepEqual(readSecrets(file), value);
    assert.doesNotMatch(readFileSync(file, 'utf8'), /dummy-local-self-test/);
    assert.equal(readSecrets(join(dir, 'missing')), null);
  } finally { rmSync(dir, { recursive: true }); }
});
test('fact check mode acknowledges first, sends each result message once and reports outages without a verdict', async t => {
  const sent = [];
  const f = await fixture(t, { config: { accessToken: 'test-token', userId: IG_ID },
    factCheck: async message => ({ messages: [`결과: ${message.text}`, '근거 링크'] }),
    apiFetch: async (url, options) => { sent.push(JSON.parse(options.body).message.text); return json({ message_id: `m${sent.length}` }); } });
  await deliver(f, [incoming()]);
  await eventually(() => f.stats.replies === 1);
  assert.deepEqual(sent, [FACTCHECK_ACK, '결과: private-message-body', '근거 링크']);
  const failing = await fixture(t, { config: { accessToken: 'test-token', userId: IG_ID },
    factCheck: async () => { throw new Error('model down'); },
    apiFetch: async (url, options) => { sent.push(JSON.parse(options.body).message.text); return json({ message_id: 'x' }); } });
  sent.length = 0;
  await deliver(failing, [incoming()]);
  await eventually(() => failing.stats.replies === 1);
  assert.deepEqual(sent, [FACTCHECK_ACK, FACTCHECK_FAILED]);
});

test('"연결" DM sends a one-time web link instead of a fact-check, using the sender handle when available', async t => {
  const sent = []; const issued = []; const tracked = []; let checks = 0;
  const f = await fixture(t, { config: { accessToken: 'test-token', userId: IG_ID },
    factCheck: async () => { checks++; return { messages: ['결과'] }; },
    trackSender: async id => { tracked.push(id); },
    issueLinkToken: async args => { issued.push(args); return 'f'.repeat(64); },
    apiFetch: async (url, options) => {
      if (url.endsWith('/123456789?fields=username')) return json({ id: '123456789', username: 'tester.one' });
      sent.push(JSON.parse(options.body).message.text); return json({ message_id: 'm' });
    } });
  await deliver(f, [incoming({ message: { mid: 'link-1', text: ' 연결 ' } })]);
  await eventually(() => f.stats.replies === 1);
  assert.equal(checks, 0);
  assert.deepEqual(tracked, ['123456789']);
  assert.deepEqual(issued, [{ igsid: '123456789', username: 'tester.one' }]);
  assert.deepEqual(sent, [linkMessage(`https://example.ngrok-free.dev/link#token=${'f'.repeat(64)}`)]);
});

test('link token failures send a retry message, and storage failures never block replies', async t => {
  const sent = [];
  const f = await fixture(t, { config: { accessToken: 'test-token', userId: IG_ID },
    trackSender: async () => { throw new Error('db down'); },
    issueLinkToken: async () => { throw new Error('db down'); },
    apiFetch: async (url, options) => {
      if (url.includes('fields=username')) throw new Error('profile unavailable');
      sent.push(JSON.parse(options.body).message.text); return json({ message_id: 'm' });
    } });
  await deliver(f, [incoming({ message: { mid: 'link-2', text: '연결' } })]);
  await eventually(() => f.stats.replies === 1);
  assert.deepEqual(sent, [LINK_FAILED]);
});

test('fact-check results are saved per sender, including outages, and save failures still deliver the answer', async t => {
  const saved = []; const sent = [];
  const send = async (url, options) => { sent.push(JSON.parse(options.body).message.text); return json({ message_id: 'm' }); };
  const f = await fixture(t, { config: { accessToken: 'test-token', userId: IG_ID },
    factCheck: async () => ({ status: 'done', verdict: 'refuted', messages: ['결과'] }),
    saveFactCheck: async (id, result) => { saved.push([id, result.status, result.verdict]); }, apiFetch: send });
  await deliver(f, [incoming({ message: { mid: 'fc-1', text: '주장' } })]);
  await eventually(() => f.stats.replies === 1);
  const failing = await fixture(t, { config: { accessToken: 'test-token', userId: IG_ID },
    factCheck: async () => { throw new Error('model down'); },
    saveFactCheck: async (id, result) => { saved.push([id, result.status, result.verdict]); throw new Error('db down'); }, apiFetch: send });
  await deliver(failing, [incoming({ message: { mid: 'fc-2', text: '주장' } })]);
  await eventually(() => failing.stats.replies === 1);
  assert.deepEqual(saved, [['123456789', 'done', 'refuted'], ['123456789', 'failed', undefined]]);
  assert.deepEqual(sent, [FACTCHECK_ACK, '결과', FACTCHECK_ACK, FACTCHECK_FAILED]);
});

test('missing handles are backfilled during a fact-check, known handles are not looked up again', async t => {
  const lookups = []; const stored = []; let known = null;
  const options = { config: { accessToken: 'test-token', userId: IG_ID },
    factCheck: async () => ({ status: 'done', messages: ['결과'] }),
    trackSender: async () => ({ username: known }),
    setUsername: async (id, username) => { stored.push([id, username]); known = username; },
    apiFetch: async url => {
      if (url.includes('fields=username')) { lookups.push(url); return json({ id: '123456789', username: 'tester.one' }); }
      return json({ message_id: 'm' });
    } };
  const f = await fixture(t, options);
  await deliver(f, [incoming({ message: { mid: 'bf-1', text: '주장' } })]);
  await eventually(() => f.stats.replies === 1);
  await deliver(f, [incoming({ message: { mid: 'bf-2', text: '주장' } })]);
  await eventually(() => f.stats.replies === 2);
  assert.equal(lookups.length, 1);
  assert.deepEqual(stored, [['123456789', 'tester.one']]);
});

test('profile lookup failures are logged as Meta codes only and never block the link reply', async t => {
  const warnings = []; const sent = []; const issued = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
  const f = await fixture(t, { config: { accessToken: 'test-token', userId: IG_ID },
    trackSender: async () => ({ username: null }),
    issueLinkToken: async args => { issued.push(args); return 'e'.repeat(64); },
    apiFetch: async (url, options) => {
      if (url.includes('fields=username')) return new Response(JSON.stringify({ error: { code: 100, error_subcode: 33,
        type: 'GraphMethodException', message: 'Object with ID 123456789 does not exist' } }), { status: 400 });
      sent.push(JSON.parse(options.body).message.text); return json({ message_id: 'm' });
    } });
  await deliver(f, [incoming({ message: { mid: 'lk-1', text: '연결' } })]);
  await eventually(() => f.stats.replies === 1);
  assert.deepEqual(issued, [{ igsid: '123456789', username: undefined }]);
  assert.equal(sent.length, 1);
  assert.deepEqual(warnings, ['Instagram profile lookup failed: Meta API 요청 실패 (HTTP 400, code 100, subcode 33, GraphMethodException)']);
  assert.ok(!warnings.join().includes('123456789'), 'sender IDs must not be logged');
});
