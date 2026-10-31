import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parsePrice, normalizeRestaurant, validateRestaurant, placesFromRows, mapLinks, placeKeyLine, priceLabel } from './public/js/restaurant-data.js';
import { createRestaurantProcessor, restaurantMessages } from './restaurant.mjs';
import { createSupabaseState } from './supabase-state.mjs';
import { restaurantRowItems, factcheckToItem, RESTAURANT_SELECT } from './public/js/dashboard-live.js';
import { resultIndex } from './content-index.mjs';

const SOURCE = '성수 국수집 예약 https://booking.example.org/noodle';
const rawResult = (over = {}) => ({ is_restaurant: true, places: [
  { name: '가상 들기름 국수집', category: '한식', intro: '들기름 막국수 집이에요.', area: '성수동', address: null, phone: null,
    hours: '11:00 – 21:00', closed: null, price_range: null, reservation: null, waiting: '점심 웨이팅', parking: null,
    menus: [{ name: '들기름 막국수', price: '11,000원', note: '면 추가 무료', signature: true }, { name: '수육', price: '시가' }, { name: ' ' }],
    links: [{ label: '예약', url: 'https://booking.example.org/noodle' }, { label: '공식', url: 'https://invented.example/x' }],
    evidence: { name: '이미지1', hours: '본문', 'bad key!': 'x' }, checks: [] },
  { name: '가상 카페', category: '브런치', menus: [], links: [], checks: [] },
], ...over });

test('menu prices are parsed only when unambiguous; the written text is always kept', () => {
  const cases = { '12,000원': 12000, '₩9,900': 9900, '12000': 12000, '1만2천원': 12000, '1.5만원': 15000, '8천원': 8000, '3만원': 30000,
    '시가': null, '12,000~15,000원': null, '1-2만원': null, '변동': null, '50': null, '': null };
  for (const [raw, won] of Object.entries(cases)) assert.equal(parsePrice(raw), won, raw);
  assert.equal(parsePrice(null), null);
  assert.equal(priceLabel({ priceWon: 12000, priceText: '1만2천원' }), '12,000원');
  assert.equal(priceLabel({ priceWon: null, priceText: '시가' }), '시가');
});

test('normalising keeps only what the post said: links from the received text, known categories, real menus', () => {
  const r = normalizeRestaurant(rawResult(), { reference: '2026-11-01', sourceText: SOURCE });
  assert.equal(r.version, 1); assert.equal(r.places.length, 2);
  const [noodle, cafe] = r.places;
  assert.deepEqual(noodle.menus.map(m => [m.name, m.priceText, m.priceWon, m.signature]),
    [['들기름 막국수', '11,000원', 11000, true], ['수육', '시가', null, false]], 'blank menu names are skipped');
  assert.deepEqual(noodle.links, [{ label: '예약', url: 'https://booking.example.org/noodle' }]);
  assert.ok(noodle.checks.some(c => c.includes('링크는 확인하지 못해')));
  assert.deepEqual(Object.keys(noodle.evidence), ['name', 'hours']);
  assert.equal(cafe.category, '기타', 'unknown categories fall back to 기타');
  assert.deepEqual(normalizeRestaurant({ is_restaurant: false }, { reference: '2026-11-01' }), { kind: 'none' });
  assert.deepEqual(normalizeRestaurant({ is_restaurant: true, places: [{ name: '' }] }, { reference: '2026-11-01' }), { kind: 'none' });
  assert.equal(validateRestaurant(r), r);
  assert.throws(() => validateRestaurant({ ...r, places: [{ ...noodle, menus: [{ name: 'x', priceWon: 1.5 }] }] }), /menu/);
});

test('map links search the place name with its address or area; list lines summarise it', () => {
  const place = normalizeRestaurant(rawResult(), { reference: '2026-11-01', sourceText: SOURCE }).places[0];
  const links = mapLinks(place);
  assert.equal(links.naver, 'https://map.naver.com/p/search/' + encodeURIComponent('가상 들기름 국수집 성수동'));
  assert.match(links.kakao, /^https:\/\/map\.kakao\.com\/link\/search\//); assert.match(links.google, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  assert.equal(placeKeyLine(place), '한식 · 성수동 · 대표 들기름 막국수 11,000원');
});

test('the processor makes one model call over every input and answers non-restaurant posts honestly', async () => {
  const calls = [];
  const message = { text: '', attachments: [{ type: 'ig_post', payload: { url: 'https://cdn.example/1.jpg', title: SOURCE } }] };
  const jpeg = { body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), contentType: 'image/jpeg' };
  const make = reply => createRestaurantProcessor({ now: () => new Date('2026-11-01T03:00:00Z'),
    model: async args => { calls.push(args); return typeof reply === 'string' ? reply : JSON.stringify(reply); } });
  const done = await make(rawResult())(message, { fetchMedia: async () => jpeg });
  assert.equal(done.status, 'done'); assert.equal(done.action, 'restaurant');
  assert.equal(done.extracted.claim, '가상 들기름 국수집 외 1곳'); assert.equal(done.extracted.topic, 'restaurant');
  assert.equal(calls.length, 1); assert.ok(calls[0].content.some(c => c.type === 'text' && c.text === '[이미지1]'));
  const dm = done.messages.join('\n');
  assert.match(dm, /\[1\/2\] 가상 들기름 국수집 · 한식/); assert.match(dm, /• 들기름 막국수 \(대표\) — 11,000원/); assert.match(dm, /네이버 지도: https:\/\/map\.naver\.com/);
  assert.equal(done.contentIndex.category, 'restaurant');
  assert.ok(done.contentIndex.entities.includes('들기름 막국수'));
  assert.match((await make({ is_restaurant: false, places: [] })(message, { fetchMedia: async () => jpeg })).messages[0], /가게 정보를 찾지 못했어요/);
  assert.equal((await make('not json')(message, { fetchMedia: async () => jpeg })).status, 'failed');
  assert.equal((await make(rawResult())(message, { fetchMedia: async () => { throw new Error('403'); } })).status, 'no_input');
});

test('a restaurant result is saved through one atomic RPC with places and menus, and returns the result id', async () => {
  const restaurant = normalizeRestaurant(rawResult(), { reference: '2026-11-01', sourceText: SOURCE });
  const calls = [];
  const state = createSupabaseState({ url: 'https://x.supabase.co', key: 'sb_secret_t',
    fetchImpl: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response('42', { status: 200 }); } });
  const saved = await state.saveFactCheck('123', { status: 'done', action: 'restaurant', restaurant,
    extracted: { claim: '가상 들기름 국수집 외 1곳', topic: 'restaurant' }, media: { sourceUrl: 'https://www.instagram.com/p/ABC/' } });
  assert.deepEqual(saved, { id: 42 });
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://x.supabase.co/rest/v1/rpc/save_restaurant_result');
  const body = calls[0].body;
  assert.equal(body.p_igsid, '123'); assert.equal(body.p_claim, '가상 들기름 국수집 외 1곳');
  assert.equal(JSON.parse(body.p_reason).sourceUrl, 'https://www.instagram.com/p/ABC/');
  assert.equal(body.p_places.length, 2);
  assert.deepEqual(body.p_places[0].menus[0], { name: '들기름 막국수', priceText: '11,000원', priceWon: 11000, note: '면 추가 무료', signature: true });
  assert.equal(body.p_places[0].waiting, '점심 웨이팅');
  await assert.rejects(state.saveFactCheck('123', { status: 'done', action: 'restaurant', restaurant: { version: 1, places: [] } }), /Invalid restaurant/);
});

// What PostgREST returns for factchecks?select=...,restaurants(..., restaurant_menus(...)) — positions may come unordered.
const row = {
  id: 77, created_at: '2026-11-01T03:00:00Z', status: 'done', topic: 'restaurant', claim: '가상 들기름 국수집 외 1곳', verdict: null,
  reason: JSON.stringify({ sourceUrl: 'https://www.instagram.com/p/ABC123/' }), sources: [], dm_status: 'sent', dm_sent_at: '2026-11-01T03:01:00Z',
  restaurants: [
    { position: 2, name: '가상 카페', category: '카페·디저트', intro: null, area: null, address: null, phone: null, hours: null, closed: null,
      price_range: null, reservation: null, waiting: null, parking: null, links: [], evidence: {}, checks: [], restaurant_menus: [] },
    { position: 1, name: '가상 들기름 국수집', category: '한식', intro: '들기름 막국수 집이에요.', area: '성수동', address: null, phone: null,
      hours: '11:00 – 21:00', closed: null, price_range: '1인 1만원대', reservation: null, waiting: '점심 웨이팅', parking: null,
      links: [{ label: '예약', url: 'https://booking.example.org/noodle' }], evidence: {}, checks: ['수육 가격은 시가예요.'],
      restaurant_menus: [{ position: 2, name: '수육', price_text: '시가', price_won: null, note: null, signature: false },
        { position: 1, name: '들기름 막국수', price_text: '11,000원', price_won: 11000, note: '면 추가 무료', signature: true }] },
  ],
};

test('DB rows become one dashboard item per place, in order, with the design fields and 미기재 fallbacks', () => {
  assert.match(RESTAURANT_SELECT, /restaurant_menus\(position, name, price_text, price_won, note, signature\)/);
  const now = new Date('2026-11-01T04:00:00Z');
  const items = restaurantRowItems(row, now);
  assert.deepEqual(items.map(i => [i.id, i.rowId, i.title]), [['fc77', 'fc77', '가상 들기름 국수집'], ['fc77-2', 'fc77', '가상 카페']]);
  const [noodle, cafe] = items;
  assert.equal(noodle.type, 'restaurant'); assert.equal(noodle.key, '한식 · 성수동 · 1인 1만원대');
  assert.deepEqual(noodle.menus.map(m => [m.name, m.price]), [['들기름 막국수', '11,000원'], ['수육', '시가']]);
  assert.equal(noodle.address, '성수동 · 상세 주소 미기재'); assert.equal(noodle.origin, 'https://www.instagram.com/p/ABC123/');
  assert.equal(cafe.address, '주소 미기재'); assert.equal(cafe.hours, '영업 시간 미기재'); assert.equal(cafe.intro, '원본에 소개 문구가 없어요.');
  assert.equal(factcheckToItem(row, now).id, 'fc77', 'single-item paths still resolve the first place');
  assert.deepEqual(restaurantRowItems({ ...row, restaurants: [] }, now), [], 'a row without places is not shown');
  assert.equal(placesFromRows(row.restaurants)[0].menus[0].name, '들기름 막국수');
});

function designModel(file, items, props = { theme: 'light' }) {
  const script = /<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/.exec(readFileSync(file, 'utf8'))[1];
  class Base { constructor(p) { this.props = p; } setState() {} }
  const model = runInNewContext(script + `\nnew Component(${JSON.stringify(props)})`, { DCLogic: Base });
  if (items) model.allItems = () => items;
  return model;
}

test('real restaurant items render through the original desktop design logic', () => {
  const items = restaurantRowItems(row, new Date('2026-11-01T04:00:00Z'));
  const model = designModel('frontend/design/Main.dc.html', items);
  Object.assign(model.state, { view: 'library', connected: true, dataset: 'empty' });
  const lib = model.renderVals();
  assert.equal(lib.typeTabs.find(t => t.label === '맛집').count, 2);
  assert.equal(lib.libItems[0].typeLabel, '맛집'); assert.equal(lib.libItems[0].dot, 'dot t-restaurant');
  Object.assign(model.state, { view: 'detail', detailId: 'fc77' });
  const v = model.renderVals();
  assert.ok(v.isDetail && v.d.isRestaurant);
  assert.equal(v.d.menuCount, 2); assert.equal(v.d.menus[0].priceCls, 'price'); assert.equal(v.d.menus[0].signature, true);
  assert.equal(v.d.closedCls, 'v miss'); assert.equal(v.d.hoursCls, 'v'); assert.ok(v.d.hasPlaceLinks);
  assert.match(v.d.mapNaver, /^https:\/\/map\.naver\.com/);
  Object.assign(model.state, { detailId: 'fc77-2' });
  assert.ok(model.renderVals().d.noMenus);
});

test('the demo includes a 맛집 sample on desktop and mobile, and mobile renders real items too', () => {
  const desktop = designModel('frontend/design/Main.dc.html');
  Object.assign(desktop.state, { view: 'detail', detailId: 'm1' });
  const d = desktop.renderVals().d;
  assert.ok(d.isRestaurant); assert.equal(d.menus[2].priceCls, 'price miss', '가격 미기재 is shown as missing');
  const items = restaurantRowItems(row, new Date('2026-11-01T04:00:00Z'));
  // dashboard-mobile.js hands real items to the mobile model exactly like this.
  const mobile = designModel('frontend/mobile/Mobile.dc.html', null, {});
  mobile._data = { ITEMS: items };
  Object.assign(mobile.state, { detailId: 'fc77', view: 'detail', dataset: 'empty' });
  const m = mobile.renderVals();
  assert.ok(m.d.isRestaurant); assert.equal(m.d.menus.length, 2);
  assert.ok(m.typeChips.some(chip => chip.label === '맛집'));
});

test('the content index files restaurants under their own category', () => {
  const index = resultIndex(null, { restaurant: normalizeRestaurant(rawResult(), { reference: '2026-11-01', sourceText: SOURCE }),
    extracted: { claim: '가상 들기름 국수집 외 1곳' } }, { scope: [], notes: [] });
  assert.equal(index.category, 'restaurant');
  assert.ok(index.entities.includes('성수동'));
});
