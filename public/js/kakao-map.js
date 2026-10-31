// Kakao map inside the dashboard's map placeholder (exhibition, 맛집 and 취향공간 details, desktop and mobile).
// The template renders an empty <div class="kmap" data-kmap data-name data-address data-area data-kind> over the
// illustrated map; Preact never renders children into it, so the map we mount there survives re-renders.
// Nothing is loaded until such a placeholder with a name or address appears, and every failure leaves the illustration.
import { KAKAO_JS_KEY } from './kakao-config.js';

const SDK = 'https://dapi.kakao.com/v2/maps/sdk.js';
// Kakao category group codes: FD6 음식점, CE7 카페, CT1 문화시설, AT4 관광명소, AD5 숙박, CS2 편의점.
const PREFERRED = { restaurant: ['FD6', 'CE7'], space: ['CE7', 'FD6', 'CT1', 'AT4', 'AD5'], exhibit: ['CT1', 'AT4'] };
const NOISE = /^(근처|부근|일대|인근|쪽|주변|앞|역)$/;

export const NOTES = {
  address: '',
  name: '이름과 지역으로 찾은 위치예요. 방문 전에 지도 앱에서 한 번 더 확인해 주세요.',
  ambiguous: '같은 이름의 장소가 여러 곳이라 위치를 표시하지 않았어요. 지도 앱에서 확인해 주세요.',
  missing: '지도에서 위치를 찾지 못했어요.',
  failed: '지도를 불러오지 못했어요.',
};

const squash = value => String(value ?? '').toLowerCase().replace(/[\s·・()[\]《》「」『』'"‘’“”\-_.,]/g, '');
/** "가상 미술관 2층" → "가상 미술관": floors, halls and parenthesised notes only hurt a place search. */
// (\b does not work after Hangul in JS regexes, so the floor token must end at a space or the end of the text.)
export const searchableName = name => String(name ?? '').replace(/\([^)]*\)/g, ' ')
  .replace(/\s+(B?\d+층|지하\s*\d+층|\d+관|\d+F)(\s.*)?$/i, '').replace(/\s+/g, ' ').trim();
const regionTokens = region => String(region ?? '').split(/\s+/).map(t => t.trim()).filter(t => t.length >= 2 && !NOISE.test(t));

/**
 * Finds where to pin a place. `svc` is { addressSearch(address), keywordSearch(query) } resolving to Kakao results.
 * 1. A written address is geocoded and wins.
 * 2. Otherwise (or if that fails) the name is searched together with its area; only results whose name matches are used,
 *    preferring ones inside the area and of a fitting category.
 * 3. A name without any area that matches several different places (chains) is not pinned.
 * Returns { lat, lng, by: 'address' | 'name', label, placeUrl? } or { by: 'ambiguous' | 'missing' }.
 */
export async function locate({ name, address, area, kind }, svc) {
  if (address) {
    const hits = await svc.addressSearch(address);
    if (hits.length) {
      const hit = hits[0];
      return { lat: Number(hit.y), lng: Number(hit.x), by: 'address', label: hit.road_address?.address_name || hit.address_name || address };
    }
  }
  const wanted = squash(searchableName(name));
  if (wanted.length < 2) return { by: 'missing' };
  const region = area || (address ? address.split(/\s+/).slice(0, 3).join(' ') : '');
  const results = await svc.keywordSearch([searchableName(name), region].filter(Boolean).join(' '));
  const named = results.filter(r => { const n = squash(r.place_name); return n && (n.includes(wanted) || wanted.includes(n)); });
  if (!named.length) return { by: 'missing' };
  const tokens = regionTokens(region);
  const inRegion = tokens.length ? named.filter(r => tokens.some(t => `${r.address_name ?? ''} ${r.road_address_name ?? ''}`.includes(t))) : [];
  let pool = inRegion.length ? inRegion : named;
  const fitting = pool.filter(r => (PREFERRED[kind] ?? []).includes(r.category_group_code));
  if (fitting.length) pool = fitting;
  if (!region) {
    const distinct = new Set(pool.map(r => r.road_address_name || r.address_name || `${r.x},${r.y}`));
    if (distinct.size > 1) return { by: 'ambiguous' };
  }
  const best = pool[0];
  return { lat: Number(best.y), lng: Number(best.x), by: 'name', label: best.road_address_name || best.address_name || best.place_name,
    placeUrl: typeof best.place_url === 'string' && best.place_url.startsWith('https://') ? best.place_url : null };
}

let loading = null;
/** Loads the SDK once (with the services library). Rejects without a key, on error or after `timeoutMs`. */
export function loadKakaoMaps({ key = KAKAO_JS_KEY, doc = globalThis.document, timeoutMs = 10000 } = {}) {
  if (!key) return Promise.reject(new Error('Kakao key missing'));
  if (globalThis.kakao?.maps?.services) return Promise.resolve(globalThis.kakao);
  loading ??= new Promise((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = `${SDK}?appkey=${encodeURIComponent(key)}&autoload=false&libraries=services`;
    script.async = true;
    // Kakao checks the requesting site's domain; send the origin only (never the /items/... path).
    script.referrerPolicy = 'strict-origin-when-cross-origin';
    const timer = setTimeout(() => reject(new Error('Kakao SDK timeout')), timeoutMs);
    script.onload = () => {
      if (!globalThis.kakao?.maps?.load) { clearTimeout(timer); reject(new Error('Kakao SDK missing')); return; }
      globalThis.kakao.maps.load(() => { clearTimeout(timer); resolve(globalThis.kakao); });
    };
    script.onerror = () => { clearTimeout(timer); reject(new Error('Kakao SDK failed')); };
    doc.head.appendChild(script);
  }).catch(error => { loading = null; throw error; });
  return loading;
}

/** Promise wrappers around kakao.maps.services (OK → results, anything else → []). */
export function kakaoServices(kakao) {
  const geocoder = new kakao.maps.services.Geocoder();
  const places = new kakao.maps.services.Places();
  const call = run => new Promise(resolve => run((data, status) => resolve(status === kakao.maps.services.Status.OK ? data : [])));
  return { addressSearch: address => call(cb => geocoder.addressSearch(address, cb)), keywordSearch: query => call(cb => places.keywordSearch(query, cb)) };
}

// Kakao's own ZoomControl (with its level slider) is taller than the 140–150px map boxes and gets cut off, so the
// map gets a compact +/− pair styled like the dashboard (.kmap-zoom in the design sources).
const MIN_LEVEL = 1, MAX_LEVEL = 14;
const PIN_KINDS = new Set(['exhibit', 'restaurant', 'space']);

/** A native link stays keyboard accessible; address-only pins are labelled, non-interactive images. */
export function createCategoryPin(doc, { kind, name, placeUrl, label }) {
  const category = PIN_KINDS.has(kind) ? kind : 'unknown';
  const pin = doc.createElement(placeUrl ? 'a' : 'span');
  pin.className = `kmap-pin kmap-pin-${category}`;
  pin.setAttribute('aria-label', `${name || label || '장소'}${placeUrl ? ' · 카카오맵에서 보기 (새 창)' : ' 위치'}`);
  if (placeUrl) {
    pin.href = placeUrl;
    pin.target = '_blank';
    pin.rel = 'noopener noreferrer';
  } else pin.setAttribute('role', 'img');
  const head = doc.createElement('span');
  head.className = 'kmap-pin-head';
  head.setAttribute('aria-hidden', 'true');
  const orb = doc.createElement('span');
  orb.className = `orb o-${category}`;
  head.appendChild(orb);
  pin.appendChild(head);
  return pin;
}

function mount(container, kakao, place) {
  const doc = container.ownerDocument ?? globalThis.document;
  const position = new kakao.maps.LatLng(place.lat, place.lng);
  container.innerHTML = '';
  const canvas = doc.createElement('div');
  canvas.className = 'kmap-canvas';
  container.appendChild(canvas);
  const map = new kakao.maps.Map(canvas, { center: position, level: 3 });
  map.setZoomable(false); // the page keeps scrolling with the wheel; zoom with the buttons
  const zoom = doc.createElement('div');
  zoom.className = 'kmap-zoom';
  for (const [text, label, delta] of [['+', '지도 확대', -1], ['−', '지도 축소', 1]]) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => map.setLevel(Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, map.getLevel() + delta)), { animate: true }));
    zoom.appendChild(button);
  }
  container.appendChild(zoom);
  const pin = createCategoryPin(doc, { ...place, kind: container.dataset.kind, name: container.dataset.name });
  // The outer box and pointer never animate: its bottom centre is the exact geographic coordinate.
  new kakao.maps.CustomOverlay({ position, map, content: pin, xAnchor: 0.5, yAnchor: 1, clickable: Boolean(place.placeUrl), zIndex: 1 });
  map.relayout(); map.setCenter(position);
  // The illustrated box is decorative (aria-hidden); a live map with buttons is not.
  container.parentElement?.removeAttribute?.('aria-hidden');
}

const cache = new Map();
const signature = el => [el.dataset.name, el.dataset.address, el.dataset.area, el.dataset.kind].join('|');

/** Mounts every not-yet-handled map placeholder under `root`. Safe to call repeatedly. */
export async function attachMaps(root = globalThis.document, { load = loadKakaoMaps, services = kakaoServices } = {}) {
  const pending = [...root.querySelectorAll('.kmap[data-kmap]')].filter(el => el.dataset.kmapFor !== signature(el));
  if (!pending.length) return;
  for (const el of pending) el.dataset.kmapFor = signature(el);
  const targets = pending.filter(el => el.dataset.name || el.dataset.address);
  if (!targets.length) return;
  let kakao;
  try { kakao = await load(); } catch { for (const el of targets) note(el, 'failed'); return; }
  const svc = services(kakao);
  await Promise.all(targets.map(async el => {
    const key = signature(el);
    if (!cache.has(key)) cache.set(key, locate({ name: el.dataset.name, address: el.dataset.address, area: el.dataset.area, kind: el.dataset.kind }, svc)
      .catch(() => ({ by: 'missing' })));
    const place = await cache.get(key);
    if (!el.isConnected || el.dataset.kmapFor !== key) return; // the detail changed while we were searching
    if (place.lat && place.lng) {
      try { mount(el, kakao, place); el.classList.add('ready'); } catch { note(el, 'failed'); return; }
    }
    note(el, place.by);
  }));
}

function note(el, kind) {
  const target = el.parentElement?.querySelector('.kmap-note');
  if (!target) return;
  target.textContent = NOTES[kind] ?? '';
  target.hidden = !target.textContent;
}

/** Watches the app for map placeholders (both dashboard layouts) and mounts them once they appear. */
export function watchMaps(root = globalThis.document?.body) {
  if (!root || typeof MutationObserver === 'undefined') return () => {};
  let queued = false;
  const run = () => { queued = false; attachMaps(root.ownerDocument ?? globalThis.document).catch(() => {}); };
  const observer = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } });
  observer.observe(root, { childList: true, subtree: true });
  run();
  return () => observer.disconnect();
}
