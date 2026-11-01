import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { normalizeSpace, validateSpace, spaceKeyLine, mapLinks, SPACE_CATEGORIES } from './public/js/space-data.js';
import { createSpaceProcessor, spaceMessages, SPACE_SYSTEM } from './space.mjs';
import { createSupabaseState } from './supabase-state.mjs';
import { spaceRowItems, factcheckToItem } from './public/js/dashboard-live.js';
import { resultIndex } from './content-index.mjs';
import { indexFromRow } from './public/js/content-index.js';

const SOURCE = '연남동 그림책 서점 예약 https://booking.example.org/books';
const rawResult = (over = {}) => ({ is_space: true, places: [
  { name: '가상 그림책 서점', category: '서점·책방', intro: '그림책을 모아 둔 서점이에요.', area: '연남동', address: null, phone: null,
    hours: '화–일 12:00 – 20:00', closed: '월요일 휴무', reservation: '낭독회는 DM 신청', waiting: null, parking: null,
    menus: [{ name: '음료', price: '5,000원' }], price_range: '1만원대',
    links: [{ label: '예약', url: 'https://booking.example.org/books' }, { label: '공식', url: 'https://invented.example/x' }],
    evidence: { name: '이미지1', hours: '본문', 'bad key!': 'x' }, checks: [] },
  { name: '가상 소품샵', category: '잡화', links: [], checks: [] },
], ...over });

test('normalising keeps the 맛집 place fields without menus or price range, links only from the received text', () => {
  const s = normalizeSpace(rawResult(), { reference: '2026-11-01', sourceText: SOURCE });
  assert.equal(s.version, 1); assert.equal(s.places.length, 2);
  const [books, shop] = s.places;
  assert.deepEqual(Object.keys(books).sort(), ['address', 'area', 'category', 'checks', 'closed', 'evidence', 'hours', 'intro', 'links', 'name',
    'parking', 'phone', 'reservation', 'waiting']);
  assert.deepEqual(books.links, [{ label: '예약', url: 'https://booking.example.org/books' }]);
  assert.ok(books.checks.some(c => c.includes('링크는 확인하지 못해')));
  assert.deepEqual(Object.keys(books.evidence), ['name', 'hours']);
  assert.equal(shop.category, '기타', 'unknown categories fall back to 기타'); assert.equal(shop.hours, null);
  assert.ok(SPACE_CATEGORIES.includes('소품샵·편집숍'));
  assert.deepEqual(normalizeSpace({ is_space: false }, { reference: '2026-11-01' }), { kind: 'none' });
  assert.deepEqual(normalizeSpace({ is_space: true, places: [{ name: ' ' }] }, { reference: '2026-11-01' }), { kind: 'none' });
  assert.equal(validateSpace(s), s);
  assert.throws(() => validateSpace({ ...s, places: [{ ...books, category: '맛집' }] }), /space place/);
  assert.throws(() => validateSpace({ ...s, places: [{ ...books, links: [{ url: 'javascript:alert(1)' }] }] }), /space place/);
  assert.equal(spaceKeyLine(books), '서점·책방 · 연남동 · 월요일 휴무');
  assert.equal(mapLinks(books).naver, 'https://map.naver.com/p/search/' + encodeURIComponent('가상 그림책 서점 연남동'));
  assert.doesNotMatch(SPACE_SYSTEM, /"menus"|price_range/);
});

test('the processor makes one model call over every input and answers non-space posts honestly', async () => {
  const calls = [];
  const message = { text: '', attachments: [{ type: 'ig_post', payload: { url: 'https://cdn.example/1.jpg', title: SOURCE } }] };
  const jpeg = { body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), contentType: 'image/jpeg' };
  const make = reply => createSpaceProcessor({ now: () => new Date('2026-11-01T03:00:00Z'),
    model: async args => { calls.push(args); return typeof reply === 'string' ? reply : JSON.stringify(reply); } });
  const done = await make(rawResult())(message, { fetchMedia: async () => jpeg });
  assert.equal(done.status, 'done'); assert.equal(done.action, 'space');
  assert.equal(done.extracted.claim, '가상 그림책 서점 외 1곳'); assert.equal(done.extracted.topic, 'space');
  assert.equal(calls.length, 1); assert.ok(calls[0].content.some(c => c.type === 'text' && c.text === '[이미지1]'));
  const dm = done.messages.join('\n');
  assert.match(dm, /\[1\/2\] 가상 그림책 서점 · 서점·책방/); assert.match(dm, /휴무: 월요일 휴무/); assert.match(dm, /네이버 지도: https:\/\/map\.naver\.com/);
  assert.doesNotMatch(dm, /메뉴|가격대/);
  assert.equal(done.contentIndex.category, 'space'); assert.ok(done.contentIndex.entities.includes('연남동'));
  assert.equal(spaceMessages(done.space).length >= 1, true);
  assert.match((await make({ is_space: false, places: [] })(message, { fetchMedia: async () => jpeg })).messages[0], /공간 정보를 찾지 못했어요/);
  assert.equal((await make('not json')(message, { fetchMedia: async () => jpeg })).status, 'failed');
  assert.equal((await make(rawResult())(message, { fetchMedia: async () => { throw new Error('403'); } })).status, 'no_input');
});

test('a 취향공간 result is saved as v1 JSON in the existing result table with topic space', async () => {
  const space = normalizeSpace(rawResult(), { reference: '2026-11-01', sourceText: SOURCE });
  const calls = [];
  const state = createSupabaseState({ url: 'https://x.supabase.co', key: 'sb_secret_t',
    fetchImpl: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return Response.json([{ id: 42 }]); } });
  const saved = await state.saveFactCheck('123', { status: 'done', action: 'space', space, verdict: 'supported',
    extracted: { claim: '가상 그림책 서점 외 1곳', topic: 'space' }, media: { sourceUrl: 'https://www.instagram.com/p/ABC/' } });
  assert.deepEqual(saved, { id: 42 });
  assert.equal(calls.length, 1); assert.match(calls[0].url, /\/rest\/v1\/factchecks\?select=id$/);
  const body = calls[0].body;
  assert.equal(body.topic, 'space'); assert.equal(body.verdict, null); assert.equal(body.claim, '가상 그림책 서점 외 1곳');
  const stored = JSON.parse(body.reason);
  assert.equal(stored.sourceUrl, 'https://www.instagram.com/p/ABC/'); assert.equal(stored.space.places[1].name, '가상 소품샵');
  await assert.rejects(state.saveFactCheck('123', { status: 'done', action: 'space', space: { version: 1, places: [] } }), /Invalid space/);
});

const row = {
  id: 88, created_at: '2026-11-01T03:00:00Z', status: 'done', topic: 'space', claim: '가상 그림책 서점 외 1곳', verdict: null,
  reason: JSON.stringify({ space: normalizeSpace(rawResult(), { reference: '2026-11-01', sourceText: SOURCE }),
    sourceUrl: 'https://www.instagram.com/p/ABC123/' }), sources: [], dm_status: 'sent', dm_sent_at: '2026-11-01T03:01:00Z',
};

test('a stored row becomes one dashboard item per place with the design fields and 미기재 fallbacks', () => {
  const now = new Date('2026-11-01T04:00:00Z');
  const items = spaceRowItems(row, now);
  assert.deepEqual(items.map(i => [i.id, i.rowId, i.title]), [['fc88', 'fc88', '가상 그림책 서점'], ['fc88-2', 'fc88', '가상 소품샵']]);
  const [books, shop] = items;
  assert.equal(books.type, 'space'); assert.equal(books.key, '서점·책방 · 연남동 · 월요일 휴무');
  assert.equal(books.address, '연남동 · 상세 주소 미기재'); assert.equal(books.origin, 'https://www.instagram.com/p/ABC123/');
  assert.equal(books.menus, undefined); assert.equal(books.priceRange, undefined);
  assert.equal(shop.address, '주소 미기재'); assert.equal(shop.hours, '운영 시간 미기재'); assert.equal(shop.waiting, '대기 정보 미기재');
  assert.equal(factcheckToItem(row, now).id, 'fc88', 'single-item paths still resolve the first place');
  assert.deepEqual(spaceRowItems({ ...row, reason: '{"space":{"version":1,"places":[]}}' }, now), [], 'a malformed row is not shown');
  assert.equal(factcheckToItem({ ...row, reason: 'not json' }, now), null, 'and never falls back to a news verdict');
  assert.equal(indexFromRow(row).category, 'space');
});

function designModel(file, items, props = { theme: 'light' }) {
  const script = /<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/.exec(readFileSync(file, 'utf8'))[1];
  class Base { constructor(p) { this.props = p; } setState() {} }
  const model = runInNewContext(script + `\nnew Component(${JSON.stringify(props)})`, { DCLogic: Base });
  if (items) model.allItems = () => items;
  return model;
}

test('real 취향공간 items render through the desktop design: filter tab, sidebar, detail without menus', () => {
  const items = spaceRowItems(row, new Date('2026-11-01T04:00:00Z'));
  const model = designModel('frontend/design/Main.dc.html', items);
  Object.assign(model.state, { view: 'library', connected: true, dataset: 'empty' });
  const lib = model.renderVals();
  assert.equal(lib.typeTabs.find(t => t.label === '취향공간').count, 2);
  assert.equal(lib.sideTypes.find(t => t.label === '취향공간').dot, 'dot t-space');
  assert.equal(lib.libItems[0].typeLabel, '취향공간'); assert.equal(lib.libItems[0].dot, 'dot t-space');
  Object.assign(model.state, { view: 'detail', detailId: 'fc88' });
  const v = model.renderVals();
  assert.ok(v.isDetail && v.d.isSpace && !v.d.isRestaurant);
  assert.equal(v.d.closedCls, 'v'); assert.equal(v.d.waitingCls, 'v miss'); assert.ok(v.d.hasPlaceLinks);
  assert.match(v.d.mapNaver, /^https:\/\/map\.naver\.com/);
  assert.ok(v.retypeOpts.some(o => o.label === '취향공간'));
});

test('the design shows the 취향공간 detail without a menu section, and the demo has a sample on desktop and mobile', () => {
  const main = readFileSync('frontend/design/Main.dc.html', 'utf8');
  const block = main.slice(main.indexOf('<!-- SPACE'), main.indexOf('<!-- CONTEST -->'));
  assert.match(block, /d\.isSpace/); assert.doesNotMatch(block, /메뉴|priceRange|운영 시간|휴무일|예약|대기|주차|전화/);
  const desktop = designModel('frontend/design/Main.dc.html');
  Object.assign(desktop.state, { view: 'detail', detailId: 'sp1' });
  assert.ok(desktop.renderVals().d.isSpace);
  const items = spaceRowItems(row, new Date('2026-11-01T04:00:00Z'));
  const mobile = designModel('frontend/mobile/Mobile.dc.html', null, {});
  mobile._data = { ITEMS: items };
  Object.assign(mobile.state, { detailId: 'fc88', view: 'detail', dataset: 'empty' });
  const m = mobile.renderVals();
  assert.ok(m.d.isSpace); assert.equal(m.d.parkingCls, 'v miss');
  assert.ok(m.typeChips.some(chip => chip.label === '취향공간'));
  const mobileSource = readFileSync('frontend/mobile/Mobile.dc.html', 'utf8');
  const mobileBlock = mobileSource.slice(mobileSource.indexOf('<!-- space'), mobileSource.indexOf('<!-- contest -->'));
  assert.doesNotMatch(mobileBlock.split('-->').slice(1).join('-->'), /메뉴|priceRange/);
});

test('the content index files 취향공간 under its own category', () => {
  const index = resultIndex(null, { space: normalizeSpace(rawResult(), { reference: '2026-11-01', sourceText: SOURCE }),
    extracted: { claim: '가상 그림책 서점 외 1곳' } }, { scope: [], notes: [] });
  assert.equal(index.category, 'space');
  assert.ok(index.entities.includes('서점·책방'));
});
