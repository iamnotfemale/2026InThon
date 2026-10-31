// 맛집: shared by the server (normalise model output before saving) and the browser (DB rows → dashboard items).
// Unlike the v1 JSON types, places and menus are stored in their own tables (restaurants, restaurant_menus).

export const RESTAURANT_CATEGORIES = ['한식', '중식', '일식', '양식', '아시아', '분식', '카페·디저트', '베이커리', '주점', '기타'];
const LIMITS = { name: 120, intro: 400, area: 60, address: 160, phone: 40, hours: 160, closed: 120, priceRange: 80,
  reservation: 160, waiting: 160, parking: 120 };

const text = (value, max) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);
const httpsUrl = value => {
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null; } catch { return null; }
};

/**
 * Menu price as written → won, only when unambiguous: "12,000원", "₩9,900", "12000", "1만2천원", "1.5만원", "8천원".
 * Ranges, "시가", "변동", several numbers or anything unclear give null (the written text is always kept).
 */
export function parsePrice(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/g, '').replace(/^₩/, '').replace(/원$/, '');
  if (!s || /[~\-–/]|시가|변동|문의|싯가/.test(s)) return null;
  let won = null;
  if (/^\d{1,3}(,\d{3})+$/.test(s) || /^\d{3,8}$/.test(s)) won = Number(s.replaceAll(',', ''));
  else {
    const m = /^(?:(\d+(?:\.\d)?)만)?(?:(\d)천)?$/.exec(s);
    if (m && (m[1] || m[2])) won = Math.round((m[1] ? Number(m[1]) * 10000 : 0) + (m[2] ? Number(m[2]) * 1000 : 0));
  }
  return won !== null && won >= 100 && won <= 10000000 ? won : null;
}

/** "12,000원" for a parsed price, else the written text. */
export const priceLabel = menu => (menu.priceWon !== null && menu.priceWon !== undefined ? menu.priceWon.toLocaleString('ko-KR') + '원' : menu.priceText);

/**
 * Model JSON → { version: 1, reference, places } (or { kind: 'none' }). Links must appear in the text we received;
 * categories outside the list become 기타; at most 10 places and 40 menus each.
 */
export function normalizeRestaurant(raw, { reference, sourceText = '' }) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid restaurant result');
  if (raw.is_restaurant !== true) return { kind: 'none' };
  const places = (Array.isArray(raw.places) ? raw.places : []).filter(place => text(place?.name, LIMITS.name)).slice(0, 10).map(place => {
    const menus = (Array.isArray(place.menus) ? place.menus : []).filter(menu => text(menu?.name, 100)).slice(0, 40).map(menu => {
      const priceText = text(menu.price, 60);
      return { name: text(menu.name, 100), priceText, priceWon: parsePrice(priceText), note: text(menu.note, 200), signature: menu.signature === true };
    });
    const links = (Array.isArray(place.links) ? place.links : []).map(link => ({ label: text(link?.label, 30) ?? '링크', url: httpsUrl(link?.url) }))
      .filter(link => link.url && sourceText.includes(link.url.replace(/\/$/, ''))).slice(0, 5);
    const checks = (Array.isArray(place.checks) ? place.checks : []).map(check => text(check, 200)).filter(Boolean).slice(0, 6);
    if ((place.links ?? []).length > links.length) checks.push('게시물 이미지 속 링크는 확인하지 못해 넣지 않았어요.');
    const evidence = Object.fromEntries(Object.entries(place.evidence && typeof place.evidence === 'object' ? place.evidence : {})
      .filter(([key, value]) => /^[a-z_]{1,30}$/.test(key) && typeof value === 'string' && value.trim()).slice(0, 30)
      .map(([key, value]) => [key, value.trim().slice(0, 80)]));
    return {
      name: text(place.name, LIMITS.name), category: RESTAURANT_CATEGORIES.includes(place.category) ? place.category : '기타',
      intro: text(place.intro, LIMITS.intro), area: text(place.area, LIMITS.area), address: text(place.address, LIMITS.address),
      phone: text(place.phone, LIMITS.phone), hours: text(place.hours, LIMITS.hours), closed: text(place.closed, LIMITS.closed),
      priceRange: text(place.price_range, LIMITS.priceRange), reservation: text(place.reservation, LIMITS.reservation),
      waiting: text(place.waiting, LIMITS.waiting), parking: text(place.parking, LIMITS.parking),
      menus, links, evidence, checks: [...new Set(checks)],
    };
  });
  if (!places.length) return { kind: 'none' };
  return { version: 1, reference, places };
}

/** Re-checks a normalised result right before saving; throws on anything the tables would reject. */
export function validateRestaurant(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.places) || !value.places.length || value.places.length > 10) {
    throw new Error('Invalid restaurant result');
  }
  for (const place of value.places) {
    if (!text(place.name, LIMITS.name) || !RESTAURANT_CATEGORIES.includes(place.category) || !Array.isArray(place.menus) || place.menus.length > 40) {
      throw new Error('Invalid restaurant place');
    }
    for (const menu of place.menus) {
      if (!text(menu.name, 100) || (menu.priceWon !== null && !(Number.isInteger(menu.priceWon) && menu.priceWon >= 0 && menu.priceWon <= 10000000))) {
        throw new Error('Invalid menu');
      }
    }
  }
  return value;
}

/** restaurants rows (with embedded restaurant_menus) from Supabase → the normalised place shape, ordered. */
export function placesFromRows(rows) {
  return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => a.position - b.position).map(row => ({
    name: row.name, category: row.category ?? '기타', intro: row.intro, area: row.area, address: row.address, phone: row.phone,
    hours: row.hours, closed: row.closed, priceRange: row.price_range, reservation: row.reservation, waiting: row.waiting, parking: row.parking,
    menus: (row.restaurant_menus ?? []).slice().sort((a, b) => a.position - b.position)
      .map(menu => ({ name: menu.name, priceText: menu.price_text, priceWon: menu.price_won, note: menu.note, signature: menu.signature === true })),
    links: Array.isArray(row.links) ? row.links.filter(link => httpsUrl(link?.url)) : [],
    evidence: row.evidence && typeof row.evidence === 'object' ? row.evidence : {}, checks: Array.isArray(row.checks) ? row.checks : [],
  }));
}

/** Search links for the place on Korean and global map services (no API keys, no location permission). */
export function mapLinks(place) {
  const query = [place.name, place.address ?? place.area].filter(Boolean).join(' ');
  const q = encodeURIComponent(query);
  return { naver: `https://map.naver.com/p/search/${q}`, kakao: `https://map.kakao.com/link/search/${q}`,
    google: `https://www.google.com/maps/search/?api=1&query=${q}` };
}

/** One-line summary for lists: "한식 · 성수동 · 대표 들기름 막국수 12,000원". */
export function placeKeyLine(place) {
  const where = place.area ?? (place.address ? place.address.split(/\s+/).slice(1, 3).join(' ') : null);
  const signature = place.menus.find(menu => menu.signature) ?? place.menus[0];
  const menu = signature && [signature.signature ? '대표 ' + signature.name : signature.name, priceLabel(signature)].filter(Boolean).join(' ');
  return [place.category, where, place.priceRange ?? menu].filter(Boolean).join(' · ');
}
