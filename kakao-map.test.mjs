import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { locate, searchableName, loadKakaoMaps, attachMaps, createCategoryPin, NOTES } from './public/js/kakao-map.js';
import { restaurantRowItems } from './public/js/dashboard-live.js';

// Kakao Local results, shaped like the SDK's (x = lng, y = lat).
const place = (name, address, category = 'FD6', x = '127.05', y = '37.54') =>
  ({ place_name: name, address_name: address, road_address_name: address.replace('동', '로'), category_group_code: category, x, y,
    place_url: 'https://place.map.kakao.com/1' });
const services = ({ address = [], keyword = [] } = {}) => {
  const calls = [];
  return { calls, addressSearch: async a => { calls.push(['address', a]); return address; },
    keywordSearch: async q => { calls.push(['keyword', q]); return keyword; } };
};

test('a written address is geocoded and wins', async () => {
  const svc = services({ address: [{ x: '127.0560', y: '37.5446', address_name: '서울 성동구 성수동2가 1', road_address: { address_name: '서울 성동구 성수이로 1' } }] });
  const result = await locate({ name: '가상 국수집', address: '서울 성동구 성수이로 1', area: '성수동', kind: 'restaurant' }, svc);
  assert.deepEqual(result, { lat: 37.5446, lng: 127.056, by: 'address', label: '서울 성동구 성수이로 1' });
  assert.deepEqual(svc.calls, [['address', '서울 성동구 성수이로 1']], 'no name search needed');
});

test('an address that does not geocode falls back to the name with that address as the area', async () => {
  const svc = services({ keyword: [place('가상 국수집 성수점', '서울 성동구 성수동2가 1')] });
  const result = await locate({ name: '가상 국수집', address: '서울 성동구 성수이로 999-99', kind: 'restaurant' }, svc);
  assert.equal(result.by, 'name'); assert.equal(result.lat, 37.54);
  assert.deepEqual(svc.calls[1], ['keyword', '가상 국수집 서울 성동구 성수이로']);
});

test('name + area: only same-name results, preferring the area and a fitting category', async () => {
  const svc = services({ keyword: [
    place('완전히 다른 가게', '서울 성동구 성수동2가 5'),                 // name does not match
    place('가상 국수집', '서울 마포구 연남동 3', 'FD6', '126.9', '37.56'),  // same name, other area
    place('가상 국수집 주차장', '서울 성동구 성수동1가 9', 'PK6', '127.01', '37.50'),
    place('가상 국수집', '서울 성동구 성수동1가 2', 'FD6', '127.04', '37.545'),
  ] });
  const result = await locate({ name: '가상 국수집', area: '성수동', kind: 'restaurant' }, svc);
  assert.equal(result.by, 'name'); assert.deepEqual([result.lat, result.lng], [37.545, 127.04]);
  assert.equal(result.placeUrl, 'https://place.map.kakao.com/1');
  assert.deepEqual(svc.calls, [['keyword', '가상 국수집 성수동']]);
  // A vague area ("홍대 근처") that no address contains still uses the area-ranked search, not a guess elsewhere.
  const vague = await locate({ name: '가상 국수집', area: '홍대 근처', kind: 'restaurant' },
    services({ keyword: [place('가상 국수집', '서울 마포구 서교동 1', 'FD6', '126.92', '37.55')] }));
  assert.deepEqual([vague.lat, vague.lng], [37.55, 126.92]);
});

test('a name with no area is pinned only when it identifies one place', async () => {
  const chain = services({ keyword: [place('가상 커피', '서울 중구 명동 1'), place('가상 커피', '부산 해운대구 우동 2', 'FD6', '129.1', '35.1')] });
  assert.deepEqual(await locate({ name: '가상 커피', kind: 'restaurant' }, chain), { by: 'ambiguous' });
  const unique = await locate({ name: '가상 커피', kind: 'restaurant' }, services({ keyword: [place('가상 커피', '서울 중구 명동 1')] }));
  assert.equal(unique.by, 'name');
  assert.deepEqual(await locate({ name: '가상 커피', kind: 'restaurant' }, services({ keyword: [place('다른 집', '서울 중구 명동 1')] })), { by: 'missing' });
  assert.deepEqual(await locate({ name: '', kind: 'restaurant' }, services()), { by: 'missing' });
});

test('exhibitions search the venue without floors or notes, preferring cultural facilities', async () => {
  assert.equal(searchableName('가상 미술관 2층'), '가상 미술관');
  assert.equal(searchableName('가상 미술관 B1층 전시실'), '가상 미술관');
  assert.equal(searchableName('가상 갤러리 (본관)'), '가상 갤러리');
  assert.equal(searchableName('서울시립미술관 서소문본관'), '서울시립미술관 서소문본관');
  const svc = services({ keyword: [place('가상 미술관 카페', '서울 종로구 사직동 1', 'CE7', '126.97', '37.57'),
    place('가상 미술관', '서울 종로구 사직동 1', 'CT1', '126.971', '37.571')] });
  const result = await locate({ name: '가상 미술관 2층', area: '종로구', kind: 'exhibit' }, svc);
  assert.deepEqual([result.lat, result.lng], [37.571, 126.971]); assert.deepEqual(svc.calls, [['keyword', '가상 미술관 종로구']]);
});

test('the SDK loads once with services and an origin-only referrer, and a failure can be retried', async () => {
  await assert.rejects(loadKakaoMaps({ key: '' }), /key missing/);
  const appended = [];
  const doc = { createElement: () => ({}), head: { appendChild: script => appended.push(script) } };
  const first = loadKakaoMaps({ key: 'k<ey>', doc, timeoutMs: 1000 });
  const again = loadKakaoMaps({ key: 'k<ey>', doc, timeoutMs: 1000 });
  assert.equal(appended.length, 1, 'one script for concurrent callers');
  assert.equal(appended[0].src, 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=k%3Cey%3E&autoload=false&libraries=services');
  assert.equal(appended[0].referrerPolicy, 'strict-origin-when-cross-origin');
  appended[0].onerror();
  await assert.rejects(first, /failed/); await assert.rejects(again, /failed/);
  const retry = loadKakaoMaps({ key: 'k', doc, timeoutMs: 1000 });
  assert.equal(appended.length, 2, 'a failed load is not cached');
  globalThis.kakao = { maps: { load: cb => cb(), services: {} } };
  appended[1].onload();
  assert.equal(await retry, globalThis.kakao);
  delete globalThis.kakao;
});

// Minimal DOM: one placeholder element and its note sibling.
function fakeNode() {
  return { children: [], attrs: {}, listeners: {}, appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, addEventListener(t, fn) { this.listeners[t] = fn; } };
}
function placeholder(dataset) {
  const noteEl = { textContent: '', hidden: true, children: [], appendChild(c) { this.children.push(c); return c; } };
  const box = { attrs: { 'aria-hidden': 'true' }, querySelector: () => noteEl, removeAttribute(k) { delete this.attrs[k]; } };
  const el = { ...fakeNode(), dataset: { kmap: '1', ...dataset }, isConnected: true, innerHTML: 'x', classList: { added: [], add(c) { this.added.push(c); } },
    parentElement: box, ownerDocument: { createElement: () => fakeNode() } };
  return { el, noteEl, box, root: { querySelectorAll: () => [el] } };
}
function fakeKakao() {
  const made = []; const overlays = [];
  class LatLng { constructor(lat, lng) { this.lat = lat; this.lng = lng; } }
  class Map { constructor(container, options) { made.push(['map', options.center.lat, options.center.lng]); } setZoomable(z) { made.push(['zoomable', z]); }
    getLevel() { return this.level ?? 3; } setLevel(l) { this.level = l; made.push(['level', l]); } relayout() {} setCenter() {} }
  class CustomOverlay { constructor(options) { overlays.push(options); made.push(['marker', options.position.lat, options.position.lng]); } }
  return { made, overlays, kakao: { maps: { LatLng, Map, CustomOverlay } } };
}

test('category pins reuse the existing orbs, safely label the place and keep only linked locations interactive', () => {
  const doc = { createElement: tag => ({ ...fakeNode(), tagName: tag }) };
  for (const [kind, expected] of [['exhibit', 'exhibit'], ['restaurant', 'restaurant'], ['space', 'space'], ['unrecognised', 'unknown']]) {
    const pin = createCategoryPin(doc, { kind, name: '<장소 이름>', label: '주소' });
    assert.equal(pin.tagName, 'span'); assert.equal(pin.attrs.role, 'img');
    assert.equal(pin.attrs['aria-label'], '<장소 이름> 위치');
    assert.equal(pin.className, 'kmap-pin kmap-pin-' + expected);
    assert.equal(pin.children[0].attrs['aria-hidden'], 'true');
    assert.equal(pin.children[0].children[0].className, 'orb o-' + expected);
  }
  const link = createCategoryPin(doc, { kind: 'space', label: '장소 주소', placeUrl: 'https://place.map.kakao.com/1' });
  assert.equal(link.tagName, 'a'); assert.equal(link.attrs.role, undefined, 'retain native link semantics and keyboard activation');
  assert.equal(link.href, 'https://place.map.kakao.com/1');
  assert.match(link.attrs['aria-label'], /장소 주소.*새 창/);
  assert.equal(link.target, '_blank'); assert.equal(link.rel, 'noopener noreferrer');
});

test('placeholders mount a pinned map, explain name-based or missing locations, and never load Kakao for nothing', async () => {
  const { made, overlays, kakao } = fakeKakao();
  const byAddress = placeholder({ name: '가상 국수집', address: '서울 성동구 성수이로 1', kind: 'restaurant' });
  await attachMaps(byAddress.root, { load: async () => kakao,
    services: () => services({ address: [{ x: '127.05', y: '37.54', address_name: '서울 성동구 성수이로 1' }] }) });
  assert.deepEqual(made.filter(m => m[0] !== 'zoomable'), [['map', 37.54, 127.05], ['marker', 37.54, 127.05]]);
  assert.ok(made.some(m => m[0] === 'zoomable' && m[1] === false), 'wheel zoom off so the page keeps scrolling');
  assert.equal(overlays[0].xAnchor, 0.5); assert.equal(overlays[0].yAnchor, 1);
  assert.equal(overlays[0].content.className, 'kmap-pin kmap-pin-restaurant');
  assert.equal(overlays[0].clickable, false);
  assert.deepEqual(byAddress.el.classList.added, ['ready']); assert.equal(byAddress.noteEl.hidden, true);
  // Compact +/− buttons instead of Kakao's slider (which overflows the small map boxes); the live map is no longer aria-hidden.
  const [canvas, zoom] = byAddress.el.children;
  assert.equal(canvas.className, 'kmap-canvas'); assert.equal(zoom.className, 'kmap-zoom');
  assert.deepEqual(zoom.children.map(b => [b.textContent, b.attrs['aria-label'], b.type]), [['+', '지도 확대', 'button'], ['−', '지도 축소', 'button']]);
  zoom.children[0].listeners.click(); zoom.children[0].listeners.click(); zoom.children[0].listeners.click();
  assert.deepEqual(made.filter(m => m[0] === 'level'), [['level', 2], ['level', 1], ['level', 1]], 'zoom in stops at level 1');
  assert.equal(byAddress.box.attrs['aria-hidden'], undefined);

  const byName = placeholder({ name: '가상 커피', area: '명동', kind: 'restaurant' });
  await attachMaps(byName.root, { load: async () => kakao, services: () => services({ keyword: [place('가상 커피', '서울 중구 명동 1')] }) });
  assert.equal(byName.noteEl.textContent, NOTES.name); assert.equal(byName.noteEl.hidden, false);
  // The note can be dismissed with an X so it stops covering the map.
  const close = byName.noteEl.children.at(-1);
  assert.equal(close.className, 'kmap-note-close'); assert.equal(close.type, 'button'); assert.equal(close.attrs['aria-label'], '안내 닫기');
  close.listeners.click(); assert.equal(byName.noteEl.hidden, true);
  assert.equal(byAddress.noteEl.children.length, 0, 'no close button without a note');
  assert.equal(overlays[1].content.href, 'https://place.map.kakao.com/1');
  assert.equal(overlays[1].content.target, '_blank'); assert.equal(overlays[1].content.rel, 'noopener noreferrer');
  assert.equal(overlays[1].clickable, true);

  const chain = placeholder({ name: '가상 체인', kind: 'restaurant' });
  await attachMaps(chain.root, { load: async () => kakao,
    services: () => services({ keyword: [place('가상 체인', '서울 중구 명동 1'), place('가상 체인', '부산 해운대구 우동 2')] }) });
  assert.equal(chain.noteEl.textContent, NOTES.ambiguous); assert.deepEqual(chain.el.classList.added, [], 'no pin');

  let loads = 0;
  const empty = placeholder({});
  await attachMaps(empty.root, { load: async () => { loads++; return kakao; }, services });
  assert.equal(loads, 0, 'demo items without a place never contact Kakao');

  const offline = placeholder({ name: '가상 바', area: '연남동', kind: 'restaurant' });
  await attachMaps(offline.root, { load: async () => { throw new Error('no key'); }, services });
  assert.equal(offline.noteEl.textContent, NOTES.failed);
  await attachMaps(offline.root, { load: async () => { loads++; return kakao; }, services });
  assert.equal(loads, 0, 'an already handled placeholder is not processed again');
});

test('all six map placeholders carry the clean place fields; only the dashboard page sends its origin', () => {
  for (const [file, count] of [['public/data/dashboard-template.json', 3], ['public/data/mobile-template.json', 3]]) {
    const template = readFileSync(file, 'utf8');
    assert.equal(template.match(/"data-kmap"/g)?.length, count, file);
    assert.match(template, /"data-name": "\{\{d\.mapName\}\}"/); assert.match(template, /"data-kind": "\{\{d\.type\}\}"/);
  }
  assert.match(readFileSync('public/dashboard.html', 'utf8'), /<meta name="referrer" content="strict-origin-when-cross-origin">/);
  assert.match(readFileSync('public/dashboard.html', 'utf8'), /href="\/css\/kakao-map\.css"/);
  for (const page of ['public/index.html', 'public/register.html']) assert.match(readFileSync(page, 'utf8'), /content="no-referrer"/);
  const [item] = restaurantRowItems({ id: 1, created_at: '2026-11-01T00:00:00Z', status: 'done', topic: 'restaurant', claim: 'x', verdict: null,
    reason: '{}', sources: [], dm_status: 'sent', dm_sent_at: null,
    restaurants: [{ position: 1, name: '가상 국수집', category: '한식', area: '성수동', address: null, links: [], evidence: {}, checks: [], restaurant_menus: [] }] });
  assert.deepEqual([item.mapName, item.mapAddress, item.mapArea, item.address], ['가상 국수집', undefined, '성수동', '성수동 · 상세 주소 미기재'],
    'the map gets the clean area, not the display wording');
});
