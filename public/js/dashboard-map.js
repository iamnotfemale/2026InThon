// 지도 tab (desktop and mobile): every 전시·팝업, 맛집 and 취향공간 place on one Kakao map, pinned with the same
// category pins as the detail maps. Preact renders the controls and the list; kakao-map.js owns the map element.
import { placeKey, syncPlaceMap } from './kakao-map.js';

export const MAP_KINDS = [['exhibit', '전시·팝업'], ['restaurant', '맛집'], ['space', '취향공간']];
const LABEL = Object.fromEntries(MAP_KINDS);

/**
 * Finished items with a place → one entry per distinct place (exhibition events at one venue share a pin).
 * Items without a clean name/address (the demo samples) are left out, exactly like the detail maps.
 */
export function mapPlaces(items, { kind = 'all', tasteOnly = false, taste = {} } = {}) {
  const groups = new Map();
  for (const item of items) {
    if (item.status !== 'done' || !LABEL[item.type] || !(item.mapName || item.mapAddress)) continue;
    if (kind !== 'all' && item.type !== kind) continue;
    if (tasteOnly && !taste[item.id]) continue;
    const place = { name: item.mapName, address: item.mapAddress, area: item.mapArea, kind: item.type };
    const key = placeKey(place);
    if (!groups.has(key)) groups.set(key, { ...place, key, title: item.title, items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}

const STATUS_NOTE = { name: '이름으로 찾은 위치', ambiguous: '같은 이름이 여러 곳이라 표시하지 않았어요', missing: '지도에서 찾지 못했어요' };

/** Template values for the 지도 tab (scope `placeMap`). */
export function placeMapValues(app, s) {
  const all = app.allItems();
  const kind = s.mapKind || 'all';
  const tasteOnly = !s.mobile && !!s.mapTasteOnly;
  const counted = mapPlaces(all, { tasteOnly, taste: s.taste || {} });
  const places = kind === 'all' ? counted : counted.filter(place => place.kind === kind);
  const located = app.mapLocated || {};
  const failed = !!located.failed;
  const pinned = places.filter(place => ['address', 'name'].includes(located[place.key])).length;
  const settled = failed || places.every(place => located[place.key]);
  const selected = places.find(place => place.key === s.mapSel) ?? null;
  const live = s.mode === 'live';
  const anyPlace = mapPlaces(all).length > 0;
  const select = key => app.setState({ mapSel: s.mapSel === key ? null : key });
  const row = (place, index) => {
    const state = located[place.key];
    const expanded = s.mapSel === place.key;
    return { id: place.key, title: place.items.map(item => item.title).join(' · '), sub: place.items[0].address || place.name || '',
      dot: 'dot t-' + place.kind, kindLabel: LABEL[place.kind], note: STATUS_NOTE[state] ?? '', hasNote: !!STATUS_NOTE[state], noteCls: 'pmap-row-note' + (state === 'name' ? '' : ' warn'),
      cls: 'pmap-row' + (s.mapSel === place.key ? ' on' : ''), pressed: String(s.mapSel === place.key), pick: () => select(place.key),
      expanded: s.mobile ? String(expanded) : undefined, panelId: s.mobile ? 'mobile-map-place-' + index : undefined,
      mobileOpen: !!s.mobile && expanded,
      details: s.mobile && expanded ? place.items.map(item => ({ id: item.id, title: item.title,
        summary: item.intro || item.summary || '', hasSummary: !!(item.intro || item.summary),
        facts: [[item.mapAddress ? '주소' : '지역', item.mapAddress || item.mapArea], ['기간', item.period], ['운영', item.hours], ['가격', item.fee || item.priceRange]]
          .filter(([, value]) => value && !/미기재$/.test(value)).map(([label, value]) => ({ label, value })),
        open: () => app.openDetail(item.id) })) : [],
      tasted: place.items.some(item => s.taste?.[item.id]) };
  };
  return {
    showIntro: !s.mobile,
    kinds: [['all', '전체', ''], ...MAP_KINDS.map(([key, label]) => [key, label, 'dot t-' + key])].map(([key, label, dot]) => ({
      label, dot, count: key === 'all' ? counted.length : counted.filter(place => place.kind === key).length,
      cls: kind === key ? 'on' : '', pressed: String(kind === key), pick: () => app.setState({ mapKind: key, mapSel: null }) })),
    tasteOnly, tastePressed: String(tasteOnly), tasteBtnCls: 'btn pmap-taste' + (tasteOnly ? ' btn-primary' : ''),
    toggleTaste: () => app.setState({ mapTasteOnly: !tasteOnly, mapSel: null }),
    hasPlaces: places.length > 0, noPlaces: places.length === 0, rows: places.map(row), placeCount: places.length,
    summary: !places.length ? '' : failed ? '지도를 불러오지 못했어요. 잠시 후 다시 열어 주세요.'
      : !settled ? `${places.length}곳의 위치를 찾고 있어요…` : `${places.length}곳 중 ${pinned}곳을 지도에 표시했어요.`,
    emptyTitle: !live && !anyPlace ? '데모 콘텐츠는 지도에 표시하지 않아요'
      : tasteOnly ? '취향에 모은 장소가 없어요' : anyPlace ? '이 유형의 장소가 없어요' : '아직 장소가 있는 콘텐츠가 없어요',
    emptyDesc: !live && !anyPlace ? '데모의 장소는 가상이에요. 로그인하면 내가 보낸 전시·팝업, 맛집, 취향공간이 핀으로 모여요.'
      : tasteOnly ? '상세 화면에서 ‘취향으로 모으기’를 누르면 여기에 모여요.'
        : anyPlace ? '다른 유형을 골라 보세요.' : '@dimi_in에 전시·팝업, 맛집, 취향공간 게시물을 보내고 정리 방식을 골라 주세요.',
    hasSelection: !!selected,
    selection: selected ? { kindLabel: LABEL[selected.kind], dot: 'dot t-' + selected.kind, sub: selected.items[0].address || selected.name || '',
      items: selected.items.map(item => ({ id: item.id, title: item.title, key: item.key || '', open: () => app.openDetail(item.id) })),
      close: () => app.setState({ mapSel: null }) } : {},
    _places: places,
  };
}

/** After each render: hands the visible places to the map element (no-op when the tab is closed). */
export function syncDashboardPlaceMap(app, values, doc = globalThis.document) {
  const el = doc?.querySelector?.('[data-placemap]');
  if (!el || !values) return;
  syncPlaceMap(el, values._places, {
    selected: app.state.mapSel ?? null,
    onSelect: key => app.setState({ mapSel: key }),
    onLocated: status => { app.mapLocated = { ...(app.mapLocated || {}), ...status }; app.setState({ mapRevision: (app.state.mapRevision || 0) + 1 }); },
  }).catch(() => {});
}
