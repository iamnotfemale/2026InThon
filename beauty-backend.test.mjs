import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHmac } from 'node:crypto';
import { createBeautyProcessor, beautyMessages, beautyProcessorFromEnv, BEAUTY_ACK } from './beauty.mjs';
import { normalizeBeauty, validateBeauty } from './public/js/beauty-data.js';
import { createSupabaseState } from './supabase-state.mjs';
import { createContentChoices } from './content-choices.mjs';
import { createDmAssistant } from './dm-assistant.mjs';
import { createMediaFactChecker } from './media-pipeline.mjs';
import { createServers, IG_ID } from './server.mjs';
import { factcheckToItem } from './public/js/dashboard-live.js';
import { inferInterests, indexFromRow } from './public/js/content-index.js';
import { scheduleProblem, calendarContent, TASTE_TYPES } from './public/js/calendar-rules.js';
import DashboardModel from './public/js/dashboard-model.js';
import { createMobileDashboard } from './public/js/dashboard-mobile.js';

const booking = 'https://example.org/booking';
const sourceUrl = 'https://www.instagram.com/p/BeautyExample/';
const rawBeauty = (sub = 'salon') => ({ version: 1, sub,
  title: sub === 'salon' ? '가상 헤어살롱 — 레이어드 컷' : '가상 크림',
  intro: '작성자가 소개한 미용 정보예요.', bFacts: [['가격', '45,000원부터'], ['용량', '']],
  points: ['작성자는 부드러운 사용감이라고 설명해요.'], place: sub === 'salon' ? '가상 헤어살롱' : null,
  address: null, hours: null, links: [['예약·구매', booking, true], ['확인 불가', 'https://invented.example/', false]],
  sponsored: sub === 'product', caution: null, linkNote: null });
const response = (sub = 'salon') => ({ is_beauty: true, beauty: rawBeauty(sub),
  content_index: { description: '작성자가 미용 제품과 사용감을 소개해요.', tags: [{ label: '크림', evidence: '본문: 크림' }] } });
const jpeg = { body: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), contentType: 'image/jpeg' };
const video = { body: Buffer.from([0, 0, 0, 16, ...Buffer.from('ftyp'), 0, 0]), contentType: 'video/mp4' };
const message = { text: '미용 게시물 ' + booking, attachments: [
  { type: 'image', payload: { url: 'image', title: '시술과 제품 소개' } }, { type: 'video', payload: { url: 'video' } },
] };

test('beauty storage keeps the v1 contract and nulls, filters unevidenced links and leaves display labels to the view', () => {
  const raw = rawBeauty(); const before = structuredClone(raw);
  const beauty = normalizeBeauty(raw, { sourceText: booking });
  assert.equal(beauty.version, 1); assert.equal(beauty.address, null); assert.equal(beauty.hours, null);
  assert.equal(beauty.caution, null); assert.equal(beauty.bFacts[1][1], '');
  assert.deepEqual(beauty.links, [['예약·구매', booking, true]]);
  assert.equal(validateBeauty(beauty).address, '주소 미기재');
  assert.equal(validateBeauty(beauty).bFacts[1][1], '미기재');
  assert.deepEqual(normalizeBeauty(beauty), beauty, 'storage validation is repeatable');
  assert.deepEqual(raw, before, 'the model result is not mutated');
  for (const url of ['javascript:alert(1)', 'https://user:pass@example.org/']) {
    assert.throws(() => normalizeBeauty({ ...raw, links: [['예약', url, true]] }), /beauty link/);
  }
  assert.throws(() => normalizeBeauty({ ...raw, sub: 'other' }), /beauty result/);
  assert.equal(beautyProcessorFromEnv({}), undefined);
});

test('salon and product processing reads every image, video and caption in one model call and creates beauty search data', async () => {
  for (const sub of ['salon', 'product']) {
    const calls = [];
    const processor = createBeautyProcessor({ model: async args => { calls.push(args); return JSON.stringify(response(sub)); } });
    const result = await processor(message, { fetchMedia: async url => url === 'image' ? jpeg : video });
    assert.equal(result.status, 'done'); assert.equal(result.action, 'beauty'); assert.equal(result.beauty.sub, sub);
    assert.equal(calls.length, 1); assert.equal(calls[0].content.filter(c => c.type === 'image').length, 1);
    assert.equal(calls[0].content.filter(c => c.type === 'video').length, 1);
    assert.ok(calls[0].content.some(c => c.text?.includes('시술과 제품 소개')));
    assert.match(calls[0].system, /작성자의 주장/);
    assert.equal(result.extracted.topic, 'beauty'); assert.equal(result.contentIndex.category, 'beauty');
    assert.equal(result.beauty.address, null); assert.equal(result.beauty.place, sub === 'product' ? null : '가상 헤어살롱');
    assert.equal(result.beauty.sponsored, sub === 'product');
    const dm = result.messages.join('\n');
    assert.match(dm, /용량: 미기재/); assert.match(dm, /게시물 작성자의 설명/);
    assert.match(dm, /디미에서/); assert.ok(dm.includes(booking));
    assert.doesNotMatch(dm, /https:\/\/invented/);
    assert.match(dm, /링크는 확인하지 못해 제외/);
    assert.ok(result.messages.every(part => Buffer.byteLength(part) <= 900));
    assert.equal(dm.includes('협찬·광고 표시'), sub === 'product');
    assert.equal(dm.includes('주소 미기재'), sub === 'salon');
  }
});

test('unreadable media, irrelevant posts, malformed results and provider failures never become completed beauty cards', async () => {
  let calls = 0;
  const make = value => createBeautyProcessor({ model: async () => { calls++; if (value instanceof Error) throw value; return value; } });
  assert.equal((await make('{}')({}, {})).status, 'no_input'); assert.equal(calls, 0);
  assert.equal((await make('{}')(message, { fetchMedia: async () => { throw new Error('private-url'); } })).status, 'no_input');
  assert.equal(calls, 0);
  for (const [value, status] of [
    [JSON.stringify({ is_beauty: false, beauty: null }), 'not_checkable'],
    ['not json', 'failed'], ['{}', 'failed'], [JSON.stringify({ is_beauty: true, beauty: {} }), 'failed'],
    [JSON.stringify({ ...response(), beauty: { ...rawBeauty(), links: [['예약', 'javascript:x', true]] } }), 'failed'],
    [new Error('private-key'), 'failed'],
  ]) {
    const result = await make(value)({ text: '시술 안내' });
    assert.equal(result.status, status); assert.equal(result.beauty, undefined);
    assert.doesNotMatch(result.messages.join(''), /private-key|private-url/);
  }
});

test('long full DMs preserve the post facts, author attribution and external booking notice within message limits', () => {
  const beauty = normalizeBeauty({ ...rawBeauty('product'), intro: '😀'.repeat(900), points: ['작성자는 ' + '촉촉해요 '.repeat(100)] });
  const parts = beautyMessages(beauty); const text = parts.join('');
  assert.ok(parts.length > 3); assert.ok(parts.every(p => Buffer.byteLength(p) <= 900 && !p.includes('\ufffd')));
  assert.ok(text.includes(beauty.intro)); assert.ok(text.includes(beauty.points[0])); assert.match(text, /외부 페이지/);
});

test('beauty persistence revalidates before writing, keeps full JSON and source/index, and forces its own topic and null verdict', async () => {
  const calls = [];
  const state = createSupabaseState({ url: 'https://db.example', key: 'sb_secret_test', fetchImpl: async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) }); return Response.json([{ id: 42 }]);
  } });
  const beauty = normalizeBeauty({ ...rawBeauty(), points: ['x'.repeat(1000), 'y'.repeat(1000), 'z'.repeat(1000)] });
  const result = { status: 'done', action: 'beauty', beauty, verdict: 'supported', extracted: { claim: 'wrong', topic: 'news' },
    contentIndex: { category: 'beauty' }, media: { sourceUrl } };
  assert.deepEqual(await state.saveFactCheck('123', result), { id: 42 });
  const row = calls[0].body; const envelope = JSON.parse(row.reason);
  assert.equal(row.topic, 'beauty'); assert.equal(row.verdict, null); assert.equal(row.claim, beauty.title);
  assert.equal(row.igsid, '123'); assert.equal(row.status, 'done');
  assert.deepEqual(envelope.beauty, beauty); assert.equal(envelope.sourceUrl, sourceUrl);
  assert.equal(envelope.contentIndex.category, 'beauty'); assert.ok(row.reason.length > 3000);
  for (const status of ['failed', 'no_input', 'not_checkable']) assert.equal(await state.saveFactCheck('123', { ...result, status }), null);
  await assert.rejects(state.saveFactCheck('123', { ...result, beauty: { ...beauty, version: 2 } }), /beauty/);
  assert.equal(calls.length, 1);
});

test('signed share → beauty choice → staged media → analysis → stored result → full DM → desktop/mobile card', async () => {
  const blobs = new Map(); const claims = new Set(); const sent = []; const rows = []; const sequence = [];
  let modelReply = response(); let modelCalls = 0; let cleaned = 0; let failSend = false; let delivery = 'full';
  const choices = createContentChoices({ secret: 'test-secret',
    getBlob: async key => blobs.has(key) ? { stream: new Response(blobs.get(key)).body } : null,
    putBlob: async (key, value) => blobs.set(key, value), deleteBlob: async key => blobs.delete(key),
    claim: async key => { if (claims.has(key)) return false; claims.add(key); return true; } });
  const processor = createMediaFactChecker({ check: createBeautyProcessor({ model: async () => {
    modelCalls++; sequence.push('model'); assert.equal(cleaned, modelCalls - 1); return JSON.stringify(modelReply);
  } }), resolveSource: async () => ({ status: 'found', url: sourceUrl, via: 'text' }), prepare: async () => ({
    files: [{ path: 'staged-image', kind: 'image' }], caption: '미용 안내 ' + booking,
    fetchMedia: async () => jpeg, cleanup: async () => { cleaned++; sequence.push('cleanup'); },
  }) });
  const state = createSupabaseState({ url: 'https://db.example', key: 'sb_secret_test', fetchImpl: async (url, init) => {
    const data = JSON.parse(init.body);
    if (init.method === 'POST') { rows.push({ ...data, id: rows.length + 1, created_at: new Date().toISOString(), dm_status: 'pending' }); return Response.json([{ id: rows.length }]); }
    Object.assign(rows.find(row => row.id === Number(new URL(url).searchParams.get('id').slice(3))), data);
    return new Response(null, { status: 204 });
  } });
  const respondToMessage = createDmAssistant({ choices, history: { read: async () => [], write: async () => {} },
    model: () => assert.fail('Beauty clicks must not enter chat'), processContent: (original, action) => {
      assert.equal(action, 'beauty'); return processor(original);
    } });
  const secret = 'test-secret';
  const servers = createServers({ config: { publicUrl: 'https://dimi.example', accessToken: 'test-token', userId: IG_ID, webhookSecret: secret },
    persist: () => {}, record: async () => {}, respondToMessage,
    saveFactCheck: state.saveFactCheck, markFactCheckSent: state.markFactCheckSent, getDeliveryMode: async () => delivery,
    apiFetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.sender_action) return Response.json({ recipient_id: body.recipient.id });
      if (failSend && body.message.text !== BEAUTY_ACK) throw new Error('Uncertain send');
      sent.push(body); sequence.push(body.message.text === BEAUTY_ACK ? 'ack' : 'send');
      return Response.json({ message_id: 'confirmed' });
    } });
  const deliver = async (mid, msg, sender = '123', signed = true) => {
    const raw = JSON.stringify({ object: 'instagram', entry: [{ id: IG_ID, messaging: [{ timestamp: Date.now(),
      sender: { id: sender }, recipient: { id: IG_ID }, message: { mid, ...msg } }] }] });
    const req = Object.assign(Readable.from([Buffer.from(raw)]), { method: 'POST', url: '/webhooks/instagram',
      headers: { 'x-hub-signature-256': signed ? 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex') : 'invalid' } });
    const res = { headersSent: false, writeHead(status) { this.status = status; this.headersSent = true; }, end() {} };
    await servers.publicServer.listeners('request')[0](req, res); return res.status;
  };
  const offer = async id => {
    await deliver('share-' + id, { text: sourceUrl });
    return sent.at(-1).message.quick_replies.find(button => button.title === '미용 정리');
  };
  assert.equal(await deliver('unsigned', { text: sourceUrl }, '123', false), 403); assert.equal(sent.length, 0);
  const button = await offer('done'); assert.equal(modelCalls, 0); assert.equal(rows.length, 0);
  await deliver('wrong-sender', { quick_reply: { payload: button.payload } }, '456'); assert.equal(modelCalls, 0);
  await deliver('click-done', { quick_reply: { payload: button.payload } });
  assert.equal(modelCalls, 1); assert.equal(cleaned, 1); assert.equal(rows.length, 1);
  assert.ok(sequence.indexOf('ack') < sequence.indexOf('model')); assert.ok(sequence.indexOf('model') < sequence.indexOf('cleanup'));
  assert.equal(rows[0].dm_status, 'sent'); assert.equal(rows[0].igsid, '123');
  assert.ok(sent.some(body => body.recipient.id === '123' && body.message.text?.includes('45,000원부터')));
  const item = factcheckToItem(rows[0]); assert.equal(item.type, 'beauty'); assert.equal(item.origin, sourceUrl);
  assert.equal(indexFromRow(rows[0]).category, 'beauty'); assert.deepEqual(inferInterests([rows[0], { ...rows[0], id: 99 }]), []);
  assert.equal(TASTE_TYPES.includes('beauty'), true);
  assert.equal(scheduleProblem(calendarContent(item), { kind: 'visit', date: '2026-11-02', time: null }), 'content');
  const app = new DashboardModel({ theme: 'light' }); app.allItems = () => [item];
  Object.assign(app.state, { view: 'detail', detailId: item.id, mode: 'live' });
  for (const values of [app.renderVals(), createMobileDashboard(app)()]) {
    assert.equal(values.d.isBeauty, true); assert.equal(values.d.tasteable, true);
    assert.equal(values.d.bLinks[0].url, booking);
  }
  await deliver('click-done', { quick_reply: { payload: button.payload } });
  await deliver('replay', { quick_reply: { payload: button.payload } }); assert.equal(modelCalls, 1);
  modelReply = { is_beauty: true, beauty: {} };
  const failed = await offer('failed'); await deliver('click-failed', { quick_reply: { payload: failed.payload } });
  assert.equal(cleaned, 2); assert.equal(rows.length, 1, 'invalid analysis is never saved');
  modelReply = response('product'); delivery = 'summary';
  const summary = await offer('summary'); await deliver('click-summary', { quick_reply: { payload: summary.payload } });
  assert.match(sent.at(-1).message.text, /https:\/\/dimi.example\/items\/fc2/); assert.equal(rows[1].dm_status, 'sent');
  const pending = await offer('pending'); failSend = true;
  await deliver('click-pending', { quick_reply: { payload: pending.payload } });
  assert.equal(rows[2].dm_status, 'pending', 'uncertain delivery is not marked as sent');
  assert.equal(cleaned, 4); assert.equal(blobs.size, 0);
});
