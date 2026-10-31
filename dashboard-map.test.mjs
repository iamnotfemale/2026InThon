import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapPlaces, placeMapValues } from './public/js/dashboard-map.js';
import { syncPlaceMap, placeKey } from './public/js/kakao-map.js';

const items = [
  { id: 'fc1', type: 'exhibit', status: 'done', title: '전시 A', mapName: '가상 미술관', mapArea: '성수동', address: '성수동' },
  { id: 'fc1-2', type: 'exhibit', status: 'done', title: '전시 B', mapName: '가상 미술관', mapArea: '성수동' },
  { id: 'fc2', type: 'restaurant', status: 'done', title: '국수집', mapName: '가상 국수집', mapAddress: '서울 중구 명동길 1' },
  { id: 'fc3', type: 'space', status: 'done', title: '책방', mapName: '가상 책방', mapArea: '연남동' },
  { id: 'fc4', type: 'recipe', status: 'done', title: '레시피', mapName: '부엌' },
  { id: 'fc5', type: 'space', status: 'processing', title: '처리 중', mapName: '어딘가' },
  { id: 'e1', type: 'exhibit', status: 'done', title: '데모 전시', place: '가상 장소' },
];

test('only finished 전시·맛집·취향공간 items with a place are pinned, one pin per place', () => {
  const places = mapPlaces(items);
  assert.deepEqual(places.map(p => [p.kind, p.name, p.items.map(i => i.id)]),
    [['exhibit', '가상 미술관', ['fc1', 'fc1-2']], ['restaurant', '가상 국수집', ['fc2']], ['space', '가상 책방', ['fc3']]]);
  assert.equal(places[1].key, placeKey({ name: '가상 국수집', address: '서울 중구 명동길 1', kind: 'restaurant' }), 'same key as the detail map');
  assert.deepEqual(mapPlaces(items, { kind: 'space' }).map(p => p.name), ['가상 책방']);
  assert.deepEqual(mapPlaces(items, { tasteOnly: true, taste: { 'fc1-2': true, fc2: false } }).map(p => p.items.map(i => i.id)), [['fc1-2']]);
});

test('the taste toggle and kind filter drive the template values', () => {
  const state = { mode: 'live', taste: { fc3: true }, mapKind: 'all' };
  const app = { state, allItems: () => items, setState: patch => Object.assign(state, patch), openDetail: id => (app.opened = id) };
  let v = placeMapValues(app, state);
  assert.deepEqual(v.kinds.map(k => [k.label, k.count]), [['전체', 3], ['전시·팝업', 1], ['맛집', 1], ['취향공간', 1]]);
  assert.equal(v.tastePressed, 'false'); assert.match(v.summary, /3곳의 위치를 찾고/);
  v.toggleTaste(); v = placeMapValues(app, state);
  assert.equal(v.tastePressed, 'true'); assert.deepEqual(v.rows.map(r => r.title), ['책방']);
  assert.equal(v.kinds[0].count, 1);
  v.kinds[1].pick(); v = placeMapValues(app, state);
  assert.equal(v.noPlaces, true); assert.equal(v.emptyTitle, '취향에 모은 장소가 없어요');
  Object.assign(state, { mapTasteOnly: false, mapKind: 'all' });
  app.mapLocated = { [mapPlaces(items)[0].key]: 'name', [mapPlaces(items)[1].key]: 'address', [mapPlaces(items)[2].key]: 'missing' };
  v = placeMapValues(app, state);
  assert.equal(v.summary, '3곳 중 2곳을 지도에 표시했어요.');
  assert.deepEqual(v.rows.map(r => r.note), ['이름으로 찾은 위치', '', '지도에서 찾지 못했어요']);
  v.rows[0].pick(); v = placeMapValues(app, state);
  assert.deepEqual(v.selection.items.map(i => i.title), ['전시 A', '전시 B']);
  v.selection.items[1].open(); assert.equal(app.opened, 'fc1-2');
  const demo = { mode: 'demo', taste: {} };
  assert.match(placeMapValues({ state: demo, allItems: () => [items[6]], setState() {} }, demo).emptyTitle, /데모/);
});

function fakeKakao() {
  const overlays = [];
  class LatLng { constructor(lat, lng) { this.lat = lat; this.lng = lng; } }
  class Map { constructor() { this.calls = []; } setZoomable() {} relayout() {} setLevel(l) { this.calls.push(['level', l]); } getLevel() { return 3; }
    setCenter(c) { this.calls.push(['center', c.lat]); } setBounds(b) { this.calls.push(['bounds', b.points.length]); } panTo(c) { this.calls.push(['pan', c.lat]); } }
  class LatLngBounds { constructor() { this.points = []; } extend(p) { this.points.push(p); } }
  class CustomOverlay { constructor(o) { Object.assign(this, o); overlays.push(this); } setMap(m) { this.map = m; } setZIndex(z) { this.zIndex = z; } }
  return { overlays, maps: { LatLng, Map, LatLngBounds, CustomOverlay } };
}
function fakeDom() {
  const make = tag => { const el = { tagName: tag.toUpperCase(), children: [], attrs: {}, dataset: {}, listeners: {}, style: {}, isConnected: true,
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(t, f) { this.listeners[t] = f; }, set innerHTML(_) { this.children = []; } }; el.ownerDocument = doc; return el; };
  const doc = { createElement: make };
  return make('div');
}

test('the tab map pins every found place once, reports what was found and only pans for a new selection', async () => {
  const kakao = fakeKakao();
  const at = { '가상 미술관': ['37.54', '127.05'], '가상 책방': ['37.55', '126.92'] };
  const svc = { addressSearch: async () => [], keywordSearch: async q => { const name = Object.keys(at).find(n => q.startsWith(n));
    return name ? [{ place_name: name, address_name: '서울 ' + q, x: at[name][1], y: at[name][0], category_group_code: 'CT1' }] : []; } };
  const container = fakeDom(); const places = mapPlaces(items);
  let status; const picked = [];
  const options = { load: async () => kakao, services: () => svc, onLocated: s => (status = s), onSelect: key => picked.push(key) };
  await syncPlaceMap(container, places, options);
  assert.equal(kakao.overlays.length, 2);
  assert.deepEqual(Object.values(status), ['name', 'missing', 'name']);
  const pin = kakao.overlays[0].content;
  assert.equal(pin.tagName, 'BUTTON'); assert.match(pin.className, /kmap-pin-exhibit/); assert.match(pin.attrs['aria-label'], /정보 보기/);
  pin.listeners.click({ stopPropagation() {} }); assert.deepEqual(picked, [places[0].key]);
  await syncPlaceMap(container, places, { ...options, selected: places[2].key });
  assert.equal(kakao.overlays.length, 2, 'same list → no new pins');
  assert.ok(kakao.overlays[1].content.classList.contains('on')); assert.equal(kakao.overlays[1].zIndex, 5);
  await syncPlaceMap(container, places.slice(2), options);
  assert.equal(kakao.overlays.filter(o => o.map).length, 1, 'old pins are removed');
  let loads = 0;
  await syncPlaceMap(fakeDom(), [], { ...options, load: async () => { loads++; return kakao; } });
  assert.equal(loads, 0, 'no places → Kakao is never contacted');
});

test('지도 tab is wired into both layouts, the route and the map-enabled headers', () => {
  const desktop = readFileSync('public/data/dashboard-template.json', 'utf8'); const mobile = readFileSync('public/data/mobile-template.json', 'utf8');
  for (const template of [desktop, mobile]) { assert.match(template, /data-placemap/); assert.match(template, /\{\{navMap\}\}/); assert.match(template, /취향에 모은 것만/); }
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
  assert.ok(vercel.rewrites.some(r => r.source === '/map' && r.destination === '/dashboard'));
  assert.match(readFileSync('public/js/dashboard-app.js', 'utf8'), /'\/map': 'map'/);
});
