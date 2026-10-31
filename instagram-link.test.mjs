import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createInstagramLink, normalizeHandle, verificationCode, createSenderHandleLookup } from './instagram-link.mjs';
import { createLinkHandler } from './api/instagram-link.mjs';
const UID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
function fixture() {
  const blobs = new Map(); const claims = new Set(); let time = 100000; let issued = 0;
  const options = { secret: 'test-only-secret', now: () => time,
    getBlob: async key => blobs.has(key) ? { stream: new Response(blobs.get(key)).body } : null,
    putBlob: async (key, data) => { blobs.set(key, data); }, deleteBlob: async key => claims.delete(key),
    claim: async key => { if (claims.has(key)) return false; claims.add(key); return true; },
    issueLinkToken: async data => { issued++; assert.equal(data.igsid, '123'); return 'a'.repeat(64); } };
  return { links: createInstagramLink(options), options, blobs, advance: ms => { time += ms; }, count: () => issued };
}
test('codes require both letters and numbers; stored challenges are encrypted and server-owned', async () => {
  const f = fixture();
  assert.equal(normalizeHandle(' @Gong.Zip.Hab '), 'gong.zip.hab');
  for (const bad of ['https://instagram.com/me', 'a b', '.bad', 'a'.repeat(31)]) assert.equal(normalizeHandle(bad), null);
  for (const bad of ['ABCDEF', '123456', 'A12', 'AB12CD!']) assert.equal(verificationCode(bad), null);
  assert.equal(verificationCode(' ab12cd '), 'AB12CD');
  const pending = await f.links.issue(UID, '@Gong.Zip.Hab');
  assert.match(pending.code, /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{6}$/);
  assert.deepEqual(await f.links.issue(UID, 'gong.zip.hab'), pending);
  assert.doesNotMatch([...f.blobs.values()].join(''), new RegExp(pending.code + '|gong.zip.hab|' + UID));
  assert.equal((await f.links.status(OTHER)).status, 'none');
});
test('a code from a different or unverified handle never links; the correct sender succeeds once and survives restart', async () => {
  const f = fixture(); const p = await f.links.issue(UID, 'gong.zip.hab');
  assert.match(await f.links.verify(p.code, '123', async () => 'someone.else'), /달라요/);
  assert.match(await f.links.verify(p.code, '123', async () => null), /확인하지 못/);
  assert.equal(f.count(), 0);
  const restarted = createInstagramLink(f.options);
  const replies = await Promise.all([1, 2].map(() => restarted.verify(p.code.toLowerCase(), '123', async () => 'GONG.ZIP.HAB')));
  assert.equal(f.count(), 1); assert.ok(replies.some(r => r.includes('확인했어요')));
  const verified = await restarted.status(UID); assert.equal(verified.status, 'verified'); assert.equal(verified.igsid, '123');
  assert.match(await restarted.verify(p.code, '123', () => assert.fail()), /이미 확인/);
});
test('expired/replaced codes, too many attempts and issuance floods are rejected', async () => {
  const f = fixture(); const p = await f.links.issue(UID, 'first');
  await assert.rejects(f.links.issue(UID, 'second'), e => e.status === 429);
  f.advance(30000);
  await f.links.issue(UID, 'second');
  assert.match(await f.links.verify(p.code, '123', () => assert.fail()), /새로 발급/);
  for (let i = 0; i < 5; i++) await f.links.verify('AB12CD', '999', () => assert.fail());
  assert.match(await f.links.verify('AB12CD', '999', () => assert.fail()), /1분/);
  f.advance(10 * 60000);
  assert.equal((await f.links.status(UID)).status, 'expired');
  assert.match(await f.links.verify(p.code, '123', () => assert.fail()), /만료/);
});
test('a temporary link-token storage failure permits a safe retry', async () => {
  const f = fixture(); let attempts = 0;
  const links = createInstagramLink({ ...f.options, issueLinkToken: async () => { if (!attempts++) throw new Error(); return 'b'.repeat(64); } });
  const p = await links.issue(UID, 'gong.zip.hab');
  await assert.rejects(links.verify(p.code, '123', async () => 'gong.zip.hab'));
  await links.verify(p.code, '123', async () => 'gong.zip.hab');
  assert.equal((await links.status(UID)).status, 'verified');
});
test('username lookup uses Meta data for the exact sender, including conversation participants when profile API is unavailable', async () => {
  const calls = [];
  const lookup = createSenderHandleLookup({ loadAccessToken: async () => 'private-token', fetchImpl: async (url, init) => {
    calls.push(url); assert.equal(init.redirect, 'error');
    if (!url.includes('/conversations?')) return Response.json({error:{code:100}}, {status:400});
    return Response.json({data:[{participants:{data:[{id:'999',username:'requested'}, {id:'123',username:'actual.sender'}]}}]});
  } });
  assert.equal(await lookup('123'), 'actual.sender'); assert.equal(calls.length, 2);
});

async function call(handler, body, headers = {}) {
  const req = Readable.from([typeof body === 'string' ? body : JSON.stringify(body)]);
  req.method = 'POST'; req.headers = { origin: 'https://inthon.yeoziphab.com', authorization:'Bearer '+ 'x'.repeat(24), ...headers };
  const res = { writeHead(status) { this.status = status; }, end(value) { this.body = JSON.parse(value); } };
  await handler(req, res); return res;
}
test('web requests validate the real Google session and never accept a browser-supplied user id', async () => {
  let owner;
  const handler = createLinkHandler({ links: { issue: async uid => { owner = uid; return { code:'AB12CD' }; } },
    fetchImpl: async () => Response.json({id:UID}) });
  assert.equal((await call(handler, {action:'issue',userId:OTHER,username:'a'})).status, 200);
  assert.equal(owner, UID);
  assert.equal((await call(handler, {}, {origin:'https://evil.example'})).status, 403);
  assert.equal((await call(handler, {}, {authorization:''})).status, 401);
  const invalid = createLinkHandler({fetchImpl:async()=>new Response(null,{status:401})});
  assert.equal((await call(invalid, {action:'status'})).status, 401);
});

test('result settings can only change the authenticated user preferences',async()=>{
  let savedUser;
  const handler=createLinkHandler({preferences:{update:async uid=>{savedUser=uid;return{delivery:'full',hidden:[]};}},
    fetchImpl:async()=>Response.json({id:UID})});
  const response=await call(handler,{action:'preferences',delivery:'full',userId:OTHER});
  assert.equal(response.status,200);assert.equal(savedUser,UID);
});
test('only DM-verified proof reaches the atomic link RPC as the authenticated user; repeat polls recover from an already consumed token', async () => {
  const requests = []; let status = {status:'pending',code:'AB12CD'};
  const handler = createLinkHandler({ links: {status:async()=>status}, fetchImpl: async (url, init) => {
    requests.push(url); assert.ok(init.headers.Authorization.startsWith('Bearer '));
    if (url.includes('/auth/v1/user')) return Response.json({id:UID});
    if (url.includes('/rpc/')) return new Response(null,{status:400});
    return Response.json([{igsid:'123'}]);
  } });
  assert.equal((await call(handler, {action:'status'})).body.status, 'pending');
  assert.ok(!requests.some(x=>x.includes('/rpc/')));
  status = {status:'verified',token:'a'.repeat(64),igsid:'123',username:'actual.sender'};
  const result = await call(handler,{action:'status'});
  assert.equal(result.body.status,'linked'); assert.ok(!JSON.stringify(result.body).includes(status.token));
  assert.ok(requests.some(x=>x.includes('/rpc/link_instagram')));
});
